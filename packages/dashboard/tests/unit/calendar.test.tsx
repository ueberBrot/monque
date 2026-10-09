// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { de, enUS } from "react-day-picker/locale";
import { describe, expect, it, vi } from "vite-plus/test";

import { Calendar } from "@/components/ui/calendar";

describe("calendar", () => {
  it("keeps calendar controls and keyboard focus when its parent rerenders", () => {
    const day = new Date(2026, 9, 9);
    const onSelect = vi.fn<(date: Date | undefined) => void>();
    const { rerender } = render(
      <Calendar mode="single" month={day} locale={enUS} onSelect={onSelect} />,
    );
    const button = screen.getByRole("button", { name: /October 9th, 2026/u });
    const root = button.closest("[data-slot=calendar]");
    button.focus();
    rerender(
      <Calendar mode="single" month={day} locale={de} onSelect={onSelect} className="p-0" />,
    );
    expect({
      sameButton: screen.getByRole("button", { name: /Freitag, 9\. Oktober 2026$/u }) === button,
      sameRoot: button.closest("[data-slot=calendar]") === root,
      focused: document.activeElement === button,
    }).toStrictEqual({ sameButton: true, sameRoot: true, focused: true });
    expect(button.dataset["day"]).toBe(day.toLocaleDateString(de.code));
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]?.[0]).toStrictEqual(day);
  });
});
