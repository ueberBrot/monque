import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getOperatorTimeZoneLabel, parseDateTime } from "@/lib/dates";
// The draft editor is loaded only when opened; this also keeps the shared form hook
// independent of the picker trigger and its registered field component.
const DateTimeEditor = lazy(async () => {
  const module = await import("@/forms/date-time-editor");
  return { default: module.DateTimeEditor };
});
/** Local calendar/time editor composed from the generated shadcn components. */
const DateTimePicker = ({
  id,
  label,
  value,
  onChange,
  allowClear = true,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly allowClear?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const current = parseDateTime(value.slice(0, 10), value.slice(11, 16));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            aria-label={label}
            variant="outline"
            className="w-full justify-start text-left font-normal"
          >
            <CalendarIcon className="size-4 text-muted-foreground" />
            {current ? format(current, "MMM d, yyyy · HH:mm") : "Choose date and time"}
          </Button>
        }
      />
      <PopoverContent
        align="start"
        collisionAvoidance={{ side: "shift", align: "shift" }}
        className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto overscroll-contain p-3"
      >
        <div className="grid gap-1">
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>Local time · {getOperatorTimeZoneLabel()}</PopoverDescription>
        </div>
        {open ? (
          <Suspense fallback={<output className="h-72">Loading calendar…</output>}>
            <DateTimeEditor
              id={id}
              value={value}
              allowClear={allowClear}
              onApply={(nextValue) => {
                onChange(nextValue);
                setOpen(false);
              }}
            />
          </Suspense>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
export { DateTimePicker };
