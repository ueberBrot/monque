import { format } from "date-fns";
import { lazy, memo, Suspense, useCallback, useMemo } from "react";

import { getOperatorTimeZoneLabel, parseDateTime } from "@/lib/dates";

import { useFieldContext } from "./context.js";

const Calendar = memo(
  lazy(async () => {
    const module = await import("@/components/ui/calendar");
    return { default: module.Calendar };
  }),
);
Calendar.displayName = "Calendar";
export const CalendarInput = ({
  value,
  onChange,
  month,
  onMonthChange,
}: {
  value: string;
  onChange: (value: string) => void;
  month: Date;
  onMonthChange: (month: Date) => void;
}) => {
  const selected = useMemo(() => parseDateTime(value, "12:00"), [value]);
  const selectDate = useCallback(
    (day: Date | undefined) => {
      if (day) {
        onChange(format(day, "yyyy-MM-dd"));
      }
    },
    [onChange],
  );
  return (
    <Suspense fallback={<output className="h-72">Loading calendar…</output>}>
      <Calendar
        mode="single"
        timeZone={getOperatorTimeZoneLabel()}
        selected={selected}
        month={month}
        onMonthChange={onMonthChange}
        onSelect={selectDate}
        className="mx-auto p-0 [--cell-size:--spacing(9)]"
      />
    </Suspense>
  );
};
export const CalendarField = ({
  month,
  onMonthChange,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
}) => {
  const field = useFieldContext<string>();
  return (
    <CalendarInput
      value={field.state.value}
      onChange={field.handleChange}
      month={month}
      onMonthChange={onMonthChange}
    />
  );
};
