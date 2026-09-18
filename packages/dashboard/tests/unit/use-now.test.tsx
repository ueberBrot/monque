// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatRelativeDate } from '@/lib/dates';
import { useNow } from '@/lib/use-now';

afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('Relative timestamp clock', () => {
	it('uses the current time when new job data arrives between clock ticks', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
		const { result, rerender, unmount } = renderHook(
			({ updatedAt }) => formatRelativeDate(updatedAt, useNow()),
			{ initialProps: { updatedAt: '2026-06-03T11:59:59Z' } },
		);
		vi.setSystemTime(new Date('2026-06-03T12:00:05Z'));
		rerender({ updatedAt: '2026-06-03T12:00:04Z' });
		expect(result.current).toBe('1 second ago');
		unmount();
	});

	it('ticks second-level labels locally and preserves future scheduled times', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
		const { result, unmount } = renderHook(() => {
			const now = useNow();
			return [
				formatRelativeDate('2026-06-03T11:59:59Z', now),
				formatRelativeDate('2026-06-03T12:00:10Z', now),
			];
		});
		act(() => vi.advanceTimersByTime(1_000));
		expect(result.current).toEqual(['2 seconds ago', 'in 9 seconds']);
		unmount();
	});

	it('updates unchanged job timestamps and cleans up its timer on unmount', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
		const { result, unmount } = renderHook(() =>
			formatRelativeDate('2026-06-03T11:54:00Z', useNow()),
		);
		expect(result.current).toBe('6 minutes ago');
		act(() => vi.advanceTimersByTime(60_000));
		expect(result.current).toBe('7 minutes ago');
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('pauses updates while hidden and catches up when visible', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
		const { result, unmount } = renderHook(() => useNow());
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		act(() => vi.advanceTimersByTime(120_000));
		expect(result.current.toISOString()).toBe('2026-06-03T12:00:00.000Z');
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		act(() => document.dispatchEvent(new Event('visibilitychange')));
		expect(result.current.toISOString()).toBe('2026-06-03T12:02:00.000Z');
		unmount();
	});
});
