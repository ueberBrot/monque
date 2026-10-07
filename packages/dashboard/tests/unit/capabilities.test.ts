import { expect, it } from "vite-plus/test";

import { listDashboardCapabilityStates } from "@/capabilities";

it.each([false, true])("explains action availability when readOnly is %s", (readOnly) => {
  const states = listDashboardCapabilityStates({
    readOnly,
    actions: {
      read: false,
      cancel: true,
      cancelBulk: false,
      retry: false,
      retryBulk: false,
      reschedule: false,
      delete: false,
      deleteBulk: false,
    },
  });

  expect(states.map((state) => state.label)).toEqual([
    "Read access",
    "Cancel job",
    "Cancel selected jobs",
    "Retry job",
    "Retry selected jobs",
    "Reschedule job",
    "Change job priority",
    "Delete job",
    "Delete selected jobs",
  ]);
  expect(states.filter((state) => state.available).map((state) => state.action)).toEqual([
    "cancel",
  ]);
  expect(states.find((state) => state.action === "cancel")?.reason).toBe("Available to you.");
  expect(states.find((state) => state.action === "read")?.reason).toBe(
    "Your host application has not enabled this action for you.",
  );
  expect(states.find((state) => state.action === "retry")?.reason).toBe(
    readOnly
      ? "This dashboard is read-only."
      : "Your host application has not enabled this action for you.",
  );
});
