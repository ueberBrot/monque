import { describe, expect, it } from 'vitest';

import {
	formatDashboardDate,
	formatRelativeDate,
	fromDateTimeLocalValue,
	parseDashboardDate,
	toDateTimeLocalValue,
} from '@/lib/dates';

describe('Dashboard dates', () => {
	it('uses the same explicit timezone for display and editing, and sends UTC to the API', () => {
		const instant = '2026-06-03T12:00:00.000Z';
		expect(formatDashboardDate(instant, 'Europe/Berlin')).toBe('Jun 3, 2026 at 14:00:00');
		expect(toDateTimeLocalValue(instant, 'Europe/Berlin')).toBe('2026-06-03T14:00');
		expect(fromDateTimeLocalValue('2026-06-03T14:00', 'Europe/Berlin')).toBe(instant);
		expect(toDateTimeLocalValue(instant, 'America/New_York')).toBe('2026-06-03T08:00');
		expect(fromDateTimeLocalValue('2026-06-03T08:00', 'America/New_York')).toBe(instant);
	});

	it('uses the correct winter and summer offsets', () => {
		expect(fromDateTimeLocalValue('2026-01-03T14:00', 'Europe/Berlin')).toBe(
			'2026-01-03T13:00:00.000Z',
		);
		expect(fromDateTimeLocalValue('2026-07-03T14:00', 'Europe/Berlin')).toBe(
			'2026-07-03T12:00:00.000Z',
		);
	});

	it('rejects nonexistent DST times, invalid dates, and invalid hours', () => {
		for (const value of ['2026-03-29T02:30', '2026-02-30T12:00', '2026-06-03T25:00', '']) {
			expect(fromDateTimeLocalValue(value, 'Europe/Berlin')).toBeUndefined();
		}
		expect(fromDateTimeLocalValue('2026-03-29T03:30', 'Europe/Berlin')).toBe(
			'2026-03-29T01:30:00.000Z',
		);
	});

	it('handles missing and malformed API timestamps without throwing', () => {
		for (const value of [undefined, null, '', 'invalid', '2026-02-30T12:00:00Z']) {
			expect(parseDashboardDate(value)).toBeUndefined();
			expect(formatDashboardDate(value)).toBe('Not available');
		}
		expect(toDateTimeLocalValue('invalid')).toBe('');
	});

	it('formats past and future timestamps against the supplied clock', () => {
		const now = new Date('2026-06-03T12:00:00Z');
		expect(formatRelativeDate('2026-06-03T11:54:00Z', now)).toBe('6 minutes ago');
		expect(formatRelativeDate('2026-06-03T12:06:00Z', now)).toBe('in 6 minutes');
	});

	it('uses just now for sub-second differences without hiding scheduled future times', () => {
		const now = new Date('2026-06-03T12:00:00Z');
		for (const value of [
			'2026-06-03T11:59:59.001Z',
			'2026-06-03T12:00:00Z',
			'2026-06-03T12:00:00.999Z',
		]) {
			expect(formatRelativeDate(value, now)).toBe('just now');
		}
		expect(formatRelativeDate('2026-06-03T12:00:01Z', now)).toBe('in 1 second');
		expect(formatRelativeDate('2026-06-03T11:59:59Z', now)).toBe('1 second ago');
	});
});
