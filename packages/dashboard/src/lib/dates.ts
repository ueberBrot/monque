import { tz } from "@date-fns/tz";
import { format, formatDistanceStrict, isValid, parse, parseISO } from "date-fns";
import { z } from "zod";

const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
const TimestampSchema = z.iso.datetime({ offset: true }).transform((value) => parseISO(value));
const LocalDateTimeSchema = z.templateLiteral([z.iso.date(), "T", z.iso.time({ precision: -1 })]);
/** All dashboard displays and editors use the operator's zone; API values remain UTC. */
const getOperatorTimeZoneLabel = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const parseDashboardDate = (value: string | null | undefined): Date | undefined => {
  const result = TimestampSchema.safeParse(value);
  return result.success ? result.data : undefined;
};
const formatDashboardDate = (
  value: string | null | undefined,
  timeZone = getOperatorTimeZoneLabel(),
): string => {
  const date = parseDashboardDate(value);
  return date ? format(date, "MMM d, yyyy 'at' HH:mm:ss", { in: tz(timeZone) }) : "Not available";
};
const formatRelativeDate = (value: string, now: Date): string => {
  const date = parseDashboardDate(value);
  if (!date) {
    return "Not available";
  }
  if (Math.abs(date.getTime() - now.getTime()) < 1000) {
    return "just now";
  }
  return formatDistanceStrict(date, now, { addSuffix: true });
};
const toDateTimeLocalValue = (value?: string, timeZone = getOperatorTimeZoneLabel()): string => {
  const date = parseDashboardDate(value);
  return date ? format(date, LOCAL_DATE_TIME_FORMAT, { in: tz(timeZone) }) : "";
};
const parseLocalDateTime = (value: string, timeZone: string): Date | undefined => {
  const result = LocalDateTimeSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  const options = { in: tz(timeZone) };
  const parsed = parse(result.data, LOCAL_DATE_TIME_FORMAT, new Date(), options);
  // Zod validates calendar input; date-fns checks whether that local time exists in this zone.
  return isValid(parsed) && format(parsed, LOCAL_DATE_TIME_FORMAT, options) === value
    ? parsed
    : undefined;
};
const parseDateTime = (
  date: string,
  time: string,
  timeZone = getOperatorTimeZoneLabel(),
): Date | undefined => parseLocalDateTime(`${date}T${time}`, timeZone);
const fromDateTimeLocalValue = (
  value: string,
  timeZone = getOperatorTimeZoneLabel(),
): string | undefined => {
  const parsed = parseLocalDateTime(value, timeZone);
  // Native serialization guarantees UTC with Z, independent of the display zone.
  return parsed ? new Date(parsed).toISOString() : undefined;
};
export {
  formatDashboardDate,
  formatRelativeDate,
  fromDateTimeLocalValue,
  getOperatorTimeZoneLabel,
  parseDashboardDate,
  parseDateTime,
  toDateTimeLocalValue,
};
