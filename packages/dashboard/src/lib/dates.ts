import { tz } from '@date-fns/tz';
import { format, formatDistanceStrict, isValid, parse, parseISO } from 'date-fns';
import { z } from 'zod';

const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
const TimestampSchema = z.iso.datetime({ offset: true }).transform((value) => parseISO(value));
const LocalDateTimeSchema = z.templateLiteral([z.iso.date(), 'T', z.iso.time({ precision: -1 })]);

/** All dashboard displays and editors use the operator's zone; API values remain UTC. */
function getOperatorTimeZoneLabel(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function parseDashboardDate(value: string | null | undefined): Date | undefined {
	const result = TimestampSchema.safeParse(value);
	return result.success ? result.data : undefined;
}

function formatDashboardDate(
	value: string | null | undefined,
	timeZone = getOperatorTimeZoneLabel(),
): string {
	const date = parseDashboardDate(value);
	return date ? format(date, "MMM d, yyyy 'at' HH:mm:ss", { in: tz(timeZone) }) : 'Not available';
}

function formatRelativeDate(value: string, now: Date): string {
	const date = parseDashboardDate(value);
	if (!date) return 'Not available';
	if (Math.abs(date.getTime() - now.getTime()) < 1_000) return 'just now';
	return formatDistanceStrict(date, now, { addSuffix: true });
}

function toDateTimeLocalValue(value?: string, timeZone = getOperatorTimeZoneLabel()): string {
	const date = parseDashboardDate(value);
	return date ? format(date, LOCAL_DATE_TIME_FORMAT, { in: tz(timeZone) }) : '';
}

function parseDateTime(
	date: string,
	time: string,
	timeZone = getOperatorTimeZoneLabel(),
): Date | undefined {
	return parseLocalDateTime(`${date}T${time}`, timeZone);
}

function parseLocalDateTime(value: string, timeZone: string): Date | undefined {
	const result = LocalDateTimeSchema.safeParse(value);
	if (!result.success) return undefined;
	const options = { in: tz(timeZone) };
	const parsed = parse(result.data, LOCAL_DATE_TIME_FORMAT, new Date(), options);
	// Zod validates calendar input; date-fns checks whether that local time exists in this zone.
	return isValid(parsed) && format(parsed, LOCAL_DATE_TIME_FORMAT, options) === value
		? parsed
		: undefined;
}

function fromDateTimeLocalValue(
	value: string,
	timeZone = getOperatorTimeZoneLabel(),
): string | undefined {
	const parsed = parseLocalDateTime(value, timeZone);
	// Native serialization guarantees UTC with Z, independent of the display zone.
	return parsed ? new Date(parsed.getTime()).toISOString() : undefined;
}

export {
	formatDashboardDate,
	formatRelativeDate,
	fromDateTimeLocalValue,
	getOperatorTimeZoneLabel,
	parseDashboardDate,
	parseDateTime,
	toDateTimeLocalValue,
};
