/**
 * Unit tests for ChangeStreamHandler service.
 *
 * Tests change stream setup, event handling, error recovery with exponential backoff,
 * and graceful fallback to polling. This is where we properly test the internal
 * change stream behavior that was previously accessed via private properties.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { ChangeStreamHandler } from '@/scheduler/services/change-stream-handler.js';

describe('ChangeStreamHandler', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let onPoll: () => Promise<void>;
	let handler: ChangeStreamHandler;

	beforeEach(() => {
		ctx = createMockContext();
		onPoll = vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>;
		handler = new ChangeStreamHandler(ctx, onPoll);
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	describe('setup', () => {
		it('should not setup if scheduler is not running', () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			handler.setup();

			expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
		});

		it('should create change stream and emit connected event', () => {
			const mockChangeStream = new EventEmitter();
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			expect(ctx.mockCollection.watch).toHaveBeenCalled();
			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({ event: 'changestream:connected' }),
			);
		});

		it('should emit fallback event when watch throws', () => {
			vi.spyOn(ctx.mockCollection, 'watch').mockImplementation(() => {
				throw new Error('Change streams not available');
			});

			handler.setup();

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({ event: 'changestream:fallback' }),
			);
		});
	});

	describe('handleEvent', () => {
		it('should not trigger poll if scheduler is not running', () => {
			vi.useFakeTimers();
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: { status: JobStatus.PENDING },
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(200);

			expect(onPoll).not.toHaveBeenCalled();
		});

		it('should trigger poll on insert event (debounced)', async () => {
			vi.useFakeTimers();
			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: { status: JobStatus.PENDING },
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Debounce should prevent immediate call
			expect(onPoll).not.toHaveBeenCalled();

			// After debounce window, poll should be called
			vi.advanceTimersByTime(150);
			expect(onPoll).toHaveBeenCalledOnce();
		});

		it('should trigger poll on update event with status change to pending', async () => {
			vi.useFakeTimers();
			const changeEvent = {
				operationType: 'update' as const,
				fullDocument: { status: JobStatus.PENDING },
				updateDescription: { updatedFields: { status: JobStatus.PENDING } },
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
		});

		it('should debounce multiple rapid events', async () => {
			vi.useFakeTimers();
			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: { status: JobStatus.PENDING },
			};

			// Trigger multiple events rapidly
			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(50);
			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(50);
			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(150);

			// Should only call once due to debouncing
			expect(onPoll).toHaveBeenCalledOnce();
		});
	});

	describe('handleError', () => {
		it('should return early if scheduler is not running', () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			const error = new Error('Connection lost');
			handler.handleError(error);

			// Should not increment reconnect attempts or emit fallback
			// (We can't directly assert on reconnectAttempts, but we verify
			// no fallback event is emitted which would happen after max attempts)
			expect(ctx.emitHistory).not.toContainEqual(
				expect.objectContaining({ event: 'changestream:fallback' }),
			);
		});

		it('should emit error event', () => {
			const mockChangeStream = new EventEmitter();
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			const error = new Error('Connection lost');
			mockChangeStream.emit('error', error);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'changestream:error',
					payload: { error },
				}),
			);
		});

		it('should attempt reconnection with exponential backoff', () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();
			const initialWatchCalls = (ctx.mockCollection.watch as ReturnType<typeof vi.fn>).mock.calls
				.length;

			// Emit error
			mockChangeStream.emit('error', new Error('First error'));

			// Should schedule reconnect after 1s (2^0 * 1000)
			vi.advanceTimersByTime(1000);

			// closeSync may be called, then watch should be called again
			expect(
				(ctx.mockCollection.watch as ReturnType<typeof vi.fn>).mock.calls.length,
			).toBeGreaterThan(initialWatchCalls);
		});

		it('should emit fallback event after exhausting reconnection attempts', () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			// Emit 4 errors (maxReconnectAttempts is 3)
			for (let i = 0; i < 4; i++) {
				mockChangeStream.emit('error', new Error(`Error ${i + 1}`));
				// Advance past the exponential backoff
				vi.advanceTimersByTime(10000);
			}

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'changestream:fallback',
					payload: expect.objectContaining({
						reason: expect.stringContaining('Exhausted'),
					}),
				}),
			);
		});
	});

	describe('close', () => {
		it('should close change stream and emit closed event', async () => {
			const mockChangeStream = {
				on: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
			};
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();
			await handler.close();

			expect(mockChangeStream.close).toHaveBeenCalled();
			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({ event: 'changestream:closed' }),
			);
		});

		it('should clear debounce and reconnect timers', async () => {
			vi.useFakeTimers();

			const mockChangeStream = {
				on: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
			};
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();
			await handler.close();

			// Verify no pending timers would cause issues
			vi.advanceTimersByTime(10000);

			expect(onPoll).not.toHaveBeenCalled();
		});
	});

	describe('handleEvent - error handling', () => {
		it('should emit job:error if poll throws', async () => {
			vi.useFakeTimers();
			const pollError = new Error('Poll failed');
			const failingOnPoll = vi.fn().mockRejectedValue(pollError);

			const handlerWithFailingPoll = new ChangeStreamHandler(ctx, failingOnPoll);

			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: { status: JobStatus.PENDING },
			};

			handlerWithFailingPoll.handleEvent(
				changeEvent as unknown as Parameters<typeof handler.handleEvent>[0],
			);
			vi.advanceTimersByTime(150);

			// Wait for the promise rejection to be handled
			await vi.runAllTimersAsync();

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: pollError }),
				}),
			);
		});
	});

	describe('close with active timers', () => {
		it('should clear reconnect timer during close', async () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			// Trigger an error to start reconnect timer
			mockChangeStream.emit('error', new Error('Connection lost'));

			// Close before reconnect timer fires
			await handler.close();

			// Advance past the reconnect delay to verify timer was cleared
			vi.advanceTimersByTime(5000);

			// Should not have tried to setup again
			const watchCallsAfterClose = (ctx.mockCollection.watch as ReturnType<typeof vi.fn>).mock.calls
				.length;
			expect(watchCallsAfterClose).toBe(1); // Only the initial setup
		});
	});

	describe('isActive', () => {
		it('should return false before setup', () => {
			expect(handler.isActive()).toBe(false);
		});

		it('should return true after successful setup', () => {
			const mockChangeStream = new EventEmitter();
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			expect(handler.isActive()).toBe(true);
		});

		it('should return false after falling back to polling', () => {
			vi.spyOn(ctx.mockCollection, 'watch').mockImplementation(() => {
				throw new Error('Not available');
			});

			handler.setup();

			expect(handler.isActive()).toBe(false);
		});
	});
});
