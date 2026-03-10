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
	let onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>;
	let handler: ChangeStreamHandler;

	beforeEach(() => {
		ctx = createMockContext();
		onPoll = vi.fn().mockResolvedValue(undefined) as unknown as (
			targetNames?: ReadonlySet<string>,
		) => Promise<void>;
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

		it('should forward change events from the stream to the handler', () => {
			vi.useFakeTimers();
			const mockChangeStream = new EventEmitter();
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();
			mockChangeStream.emit('change', {
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'test-job',
					nextRunAt: new Date(Date.now() - 1000),
				},
			});
			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['test-job']));
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
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
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

		it('should stop before scheduling reconnect if scheduler stops mid-handler', () => {
			vi.useFakeTimers();
			vi.spyOn(ctx, 'isRunning').mockReturnValueOnce(true).mockReturnValueOnce(false);

			handler.handleError(new Error('Connection lost'));
			vi.runAllTimers();

			expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
			expect(ctx.emitHistory).not.toContainEqual(
				expect.objectContaining({ event: 'changestream:fallback' }),
			);
		});

		it('should abort reconnect when scheduler stops before reconnect starts', () => {
			vi.useFakeTimers();
			vi.spyOn(ctx, 'isRunning')
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(true)
				.mockReturnValue(false);

			handler.handleError(new Error('Connection lost'));
			vi.advanceTimersByTime(1000);

			expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
		});

		it('should abort reconnect when scheduler stops after closing the stream', () => {
			vi.useFakeTimers();
			vi.spyOn(ctx, 'isRunning')
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(true)
				.mockReturnValue(false);

			handler.handleError(new Error('Connection lost'));
			vi.advanceTimersByTime(1000);

			expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
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

		it('should fallback after exhausting attempts without an active change stream', () => {
			for (let i = 0; i < 4; i++) {
				handler.handleError(new Error(`Error ${i + 1}`));
			}

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'changestream:fallback',
					payload: expect.objectContaining({
						reason: expect.stringContaining('Exhausted 3 reconnection attempts'),
					}),
				}),
			);
		});

		it('should set isActive to false during reconnection backoff', () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();
			expect(handler.isActive()).toBe(true);

			// Error triggers backoff — isActive should immediately be false
			mockChangeStream.emit('error', new Error('Connection lost'));
			expect(handler.isActive()).toBe(false);

			// After reconnect timer fires and setup succeeds, isActive is restored
			vi.advanceTimersByTime(1000);
			expect(handler.isActive()).toBe(true);
		});

		it('should clear stale wakeup timer on error', () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			// Schedule a wakeup timer via a future-dated job event
			const futureDate = new Date(Date.now() + 5000);
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					name: 'test-job',
					status: JobStatus.PENDING,
					nextRunAt: futureDate,
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Error should clear the wakeup timer
			mockChangeStream.emit('error', new Error('Connection lost'));

			// Advance past when the wakeup would have fired
			vi.advanceTimersByTime(6000);

			// The wakeup poll should NOT have fired (only the reconnect poll may have)
			expect(onPoll).not.toHaveBeenCalled();
		});

		it('should clear stale debounce timer on error', () => {
			vi.useFakeTimers();
			const mockChangeStream = Object.assign(new EventEmitter(), {
				close: vi.fn().mockResolvedValue(undefined),
			});
			vi.spyOn(ctx.mockCollection, 'watch').mockReturnValue(
				mockChangeStream as unknown as ReturnType<typeof ctx.mockCollection.watch>,
			);

			handler.setup();

			// Trigger an event that starts the debounce timer
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					name: 'test-job',
					status: JobStatus.PENDING,
					nextRunAt: new Date(Date.now() - 1000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Error should clear the debounce timer before it fires
			mockChangeStream.emit('error', new Error('Connection lost'));

			// Advance past the debounce window (100ms)
			vi.advanceTimersByTime(150);

			// The debounced poll should NOT have fired
			expect(onPoll).not.toHaveBeenCalled();
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

		it('should clear an active debounce timer before it fires', async () => {
			vi.useFakeTimers();

			handler.handleEvent({
				operationType: 'insert',
				fullDocument: { status: JobStatus.PENDING },
			} as unknown as Parameters<typeof handler.handleEvent>[0]);
			await handler.close();
			vi.advanceTimersByTime(150);

			expect(onPoll).not.toHaveBeenCalled();
		});
	});

	describe('handleEvent - targeted polling', () => {
		it('should pass job name to onPoll for immediate jobs', () => {
			vi.useFakeTimers();
			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'email',
					nextRunAt: new Date(Date.now() - 1000),
				},
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['email']));
		});

		it('should collect multiple job names during debounce window', () => {
			vi.useFakeTimers();
			const pastDate = new Date(Date.now() - 1000);

			handler.handleEvent({
				operationType: 'insert',
				fullDocument: { status: JobStatus.PENDING, name: 'email', nextRunAt: pastDate },
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(50);

			handler.handleEvent({
				operationType: 'insert',
				fullDocument: { status: JobStatus.PENDING, name: 'sms', nextRunAt: pastDate },
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['email', 'sms']));
		});

		it('should fall back to full poll when fullDocument has no name', () => {
			vi.useFakeTimers();
			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: { status: JobStatus.PENDING },
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
			// No target names — falls back to full poll with undefined
			expect(onPoll).toHaveBeenCalledWith(undefined);
		});

		it('should trigger poll on update event with status change to pending', () => {
			vi.useFakeTimers();
			const pastDate = new Date(Date.now() - 1000);
			const changeEvent = {
				operationType: 'update' as const,
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'retry-job',
					nextRunAt: pastDate,
				},
				updateDescription: { updatedFields: { status: JobStatus.PENDING } },
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);
			vi.advanceTimersByTime(150);

			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['retry-job']));
		});
	});

	describe('handleEvent - future job wakeup', () => {
		it('should schedule wakeup timer for future jobs', () => {
			vi.useFakeTimers();
			const futureDate = new Date(Date.now() + 5000);
			const changeEvent = {
				operationType: 'insert' as const,
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'scheduled',
					nextRunAt: futureDate,
				},
			};

			handler.handleEvent(changeEvent as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Should NOT have polled immediately
			vi.advanceTimersByTime(150);
			expect(onPoll).not.toHaveBeenCalled();

			// Should NOT fire before delay + grace period (5000 + 200 = 5200ms)
			vi.advanceTimersByTime(4900);
			expect(onPoll).not.toHaveBeenCalled();

			// Should fire after the grace period
			vi.advanceTimersByTime(200);
			expect(onPoll).toHaveBeenCalledOnce();
		});

		it('should use earliest nextRunAt when multiple future jobs arrive', () => {
			vi.useFakeTimers();

			// First job at +10s
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'late',
					nextRunAt: new Date(Date.now() + 10000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Second job at +3s (earlier — should replace timer)
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'early',
					nextRunAt: new Date(Date.now() + 3000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Should fire at ~3200ms, not 10200ms
			vi.advanceTimersByTime(3200);
			expect(onPoll).toHaveBeenCalledOnce();
		});

		it('should not replace timer when later job arrives', () => {
			vi.useFakeTimers();

			// First job at +3s
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'early',
					nextRunAt: new Date(Date.now() + 3000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Second job at +10s (later — should NOT replace timer)
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'late',
					nextRunAt: new Date(Date.now() + 10000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Should still fire at ~3200ms
			vi.advanceTimersByTime(3200);
			expect(onPoll).toHaveBeenCalledOnce();
		});

		it('should trigger full poll when wakeup fires (not targeted)', () => {
			vi.useFakeTimers();
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'scheduled',
					nextRunAt: new Date(Date.now() + 1000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(1200);

			expect(onPoll).toHaveBeenCalledOnce();
			// Wakeup fires a full poll (no target names)
			expect(onPoll).toHaveBeenCalledWith();
		});

		it('should clear wakeup timer on close()', async () => {
			vi.useFakeTimers();
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'scheduled',
					nextRunAt: new Date(Date.now() + 5000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			await handler.close();

			// Advance past the wakeup time
			vi.advanceTimersByTime(6000);
			expect(onPoll).not.toHaveBeenCalled();
		});
	});

	describe('handleEvent - mixed immediate and future', () => {
		it('should handle immediate and future jobs independently', () => {
			vi.useFakeTimers();
			const pastDate = new Date(Date.now() - 1000);

			// Immediate job — triggers targeted debounced poll
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'immediate',
					nextRunAt: pastDate,
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Future job — schedules wakeup
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'future',
					nextRunAt: new Date(Date.now() + 5000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Debounced poll fires for the immediate job
			vi.advanceTimersByTime(150);
			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['immediate']));

			// Wakeup fires for the future job
			vi.advanceTimersByTime(5200);
			expect(onPoll).toHaveBeenCalledTimes(2);
		});
	});

	describe('handleEvent - slot freed (completed/failed)', () => {
		it('should trigger targeted poll when job status changes to completed', () => {
			vi.useFakeTimers();

			handler.handleEvent({
				operationType: 'update',
				updateDescription: { updatedFields: { status: 'completed' } },
				fullDocument: {
					status: JobStatus.COMPLETED,
					name: 'email',
					nextRunAt: new Date(),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);
			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['email']));
		});

		it('should trigger targeted poll when job status changes to failed', () => {
			vi.useFakeTimers();

			handler.handleEvent({
				operationType: 'update',
				updateDescription: { updatedFields: { status: 'failed' } },
				fullDocument: {
					status: JobStatus.FAILED,
					name: 'sms',
					nextRunAt: new Date(),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);
			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['sms']));
		});

		it('should coalesce slot-freed events with insert events during debounce', () => {
			vi.useFakeTimers();

			// Insert event for a new pending job
			handler.handleEvent({
				operationType: 'insert',
				fullDocument: {
					status: JobStatus.PENDING,
					name: 'email',
					nextRunAt: new Date(Date.now() - 1000),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			// Slot freed by completed job for same worker
			handler.handleEvent({
				operationType: 'update',
				updateDescription: { updatedFields: { status: 'completed' } },
				fullDocument: {
					status: JobStatus.COMPLETED,
					name: 'email',
					nextRunAt: new Date(),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);
			// Single debounced poll with the worker name
			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(new Set(['email']));
		});

		it('should fall back to full poll when completed event has no name', () => {
			vi.useFakeTimers();

			handler.handleEvent({
				operationType: 'update',
				updateDescription: { updatedFields: { status: 'completed' } },
				fullDocument: {
					status: JobStatus.COMPLETED,
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);
			expect(onPoll).toHaveBeenCalledOnce();
			expect(onPoll).toHaveBeenCalledWith(undefined);
		});

		it('should not trigger on status change to processing', () => {
			vi.useFakeTimers();

			handler.handleEvent({
				operationType: 'update',
				updateDescription: { updatedFields: { status: 'processing' } },
				fullDocument: {
					status: JobStatus.PROCESSING,
					name: 'email',
					nextRunAt: new Date(),
				},
			} as unknown as Parameters<typeof handler.handleEvent>[0]);

			vi.advanceTimersByTime(150);
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
