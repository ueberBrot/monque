// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { JobActionDialog } from "@/features/jobs/job-action-dialog";
import type { JobActionDialogState } from "@/features/jobs/job-action-dialog";
import type { RunJobActionsInput } from "@/features/jobs/job-actions";
import { fromDateTimeLocalValue } from "@/lib/dates";

import { forEachSequential } from "../setup/sequential.js";

describe("job action dialog", () => {
  describe("Job action confirmation", () => {
    it.each(["single", "bulk"] as const)(
      "submits an explicit UTC run time for %s rescheduling",
      async (scope) => {
        const onConfirm = vi.fn<(input: RunJobActionsInput) => void>();
        const state: JobActionDialogState = {
          action: "reschedule",
          scope,
          jobIds: scope === "single" ? ["job-a"] : ["job-a", "job-b"],
          nextRunAt: "2026-12-03T14:30",
        };
        render(
          <JobActionDialog
            state={state}
            busy={false}
            onClose={vi.fn<() => void>()}
            onConfirm={onConfirm}
          />,
        );
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: /Confirm reschedule/u }));
        await waitFor(() => {
          expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
            action: "reschedule",
            jobIds: state.jobIds,
            nextRunAt: fromDateTimeLocalValue(state.nextRunAt),
          });
        });
      },
    );

    it("keeps an edited draft across refreshes and resets it when reopened", async () => {
      const onConfirm = vi.fn<(input: RunJobActionsInput) => void>();
      const state: JobActionDialogState = {
        action: "reschedule",
        scope: "single",
        jobIds: ["job-a"],
        nextRunAt: "2026-12-03T14:30",
      };
      const props = { busy: false, onClose: vi.fn<() => void>(), onConfirm };
      const { rerender } = render(<JobActionDialog {...props} state={state} />);
      fireEvent.click(screen.getByRole("button", { name: "Next run at" }));
      fireEvent.change(await screen.findByLabelText("Time (24h)", {}, { timeout: 5000 }), {
        target: { value: "16:45" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => {
        expect(screen.queryByLabelText("Time (24h)")).toBeNull();
      });
      rerender(<JobActionDialog {...props} state={{ ...state }} />);
      fireEvent.click(screen.getByRole("button", { name: "Confirm reschedule job" }));
      await waitFor(() => {
        expect(onConfirm).toHaveBeenLastCalledWith({
          action: "reschedule",
          jobIds: ["job-a"],
          nextRunAt: fromDateTimeLocalValue("2026-12-03T16:45"),
        });
      });
      rerender(<JobActionDialog {...props} state={null} />);
      rerender(<JobActionDialog {...props} state={state} />);
      fireEvent.click(screen.getByRole("button", { name: "Confirm reschedule job" }));
      await waitFor(() => {
        expect(onConfirm).toHaveBeenLastCalledWith({
          action: "reschedule",
          jobIds: ["job-a"],
          nextRunAt: fromDateTimeLocalValue(state.nextRunAt),
        });
      });
    });

    it.each(["", "2026-02-30T14:30"])(
      "does not submit an absent or invalid run time: %s",
      (nextRunAt) => {
        const onConfirm = vi.fn<(input: RunJobActionsInput) => void>();
        render(
          <JobActionDialog
            state={{ action: "reschedule", scope: "single", jobIds: ["job-a"], nextRunAt }}
            busy={false}
            onClose={vi.fn<() => void>()}
            onConfirm={onConfirm}
          />,
        );
        const button = screen.getByRole("button", { name: "Confirm reschedule job" });
        expect(button.hasAttribute("disabled")).toBe(true);
        fireEvent.click(button);
        expect(onConfirm).not.toHaveBeenCalled();
      },
    );
  });

  it("requires confirmation with a signed safe-integer priority and retains the original target", async () => {
    const onConfirm = vi.fn<(input: RunJobActionsInput) => void>();
    render(
      <JobActionDialog
        state={{
          action: "priority",
          scope: "single",
          jobIds: ["job-a"],
          nextRunAt: "",
          priority: "7",
        }}
        busy={false}
        onClose={vi.fn<() => void>()}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Priority" });
    const descriptionId = input.getAttribute("aria-describedby");
    // oxlint-disable-next-line unicorn/prefer-query-selector -- React IDs may contain CSS selector punctuation.
    const description = document.getElementById(descriptionId ?? "");
    expect({
      draft: input.getAttribute("value"),
      currentPriority: screen.getByText(/Current priority:/u).textContent,
      explainsDefault: description?.textContent?.includes("The default is 0"),
    }).toStrictEqual({ draft: "7", currentPriority: "Current priority: 7", explainsDefault: true });
    const confirm = screen.getByRole("button", { name: "Confirm priority change" });
    expect(onConfirm).not.toHaveBeenCalled();
    await forEachSequential(
      [
        ["", "Enter a priority, such as 0, 10, or -10."],
        ["1.5", "Use a whole number, such as 0, 10, or -10."],
        [
          "9007199254740992",
          "That number is too large. Use a value closer to 0, such as 10 or -10.",
        ],
      ] as const,
      async ([priority, message]) => {
        fireEvent.change(input, { target: { value: priority } });
        const error = await screen.findByText(message);
        expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(confirm.hasAttribute("disabled")).toBe(true);
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
      },
    );
    fireEvent.change(input, { target: { value: "-12" } });
    await waitFor(() => {
      expect(input.getAttribute("aria-invalid")).toBe("false");
    });
    expect({
      description: input.getAttribute("aria-describedby"),
      currentPriority: screen.getByText(/Current priority:/u).textContent,
      disabled: confirm.hasAttribute("disabled"),
    }).toStrictEqual({
      description: descriptionId,
      currentPriority: "Current priority: 7",
      disabled: false,
    });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
        action: "priority",
        jobIds: ["job-a"],
        priority: -12,
      });
    });
  });

  it("confirms one shared priority for the explicit selected scope", async () => {
    const onConfirm = vi.fn<(input: RunJobActionsInput) => void>();
    render(
      <JobActionDialog
        state={{ action: "priority", scope: "bulk", jobIds: ["job-a", "job-b"], nextRunAt: "" }}
        busy={false}
        onClose={vi.fn<() => void>()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Confirm priority changes" });
    const input = screen.getByRole("spinbutton", { name: "Priority" });
    expect({
      invalid: input.getAttribute("aria-invalid"),
      error: screen.queryByRole("alert"),
      disabled: confirm.hasAttribute("disabled"),
    }).toStrictEqual({ invalid: "false", error: null, disabled: true });
    fireEvent.blur(input);
    await expect(
      screen.findByText("Enter a priority, such as 0, 10, or -10."),
    ).resolves.toBeInstanceOf(HTMLElement);
    fireEvent.change(input, {
      target: { value: "-12" },
    });
    expect(screen.getByRole("dialog").textContent).toContain(
      "Set priority to -12 for 2 selected jobs.",
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
        action: "priority",
        jobIds: ["job-a", "job-b"],
        priority: -12,
      });
    });
  });
});
