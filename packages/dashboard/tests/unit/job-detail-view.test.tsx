// @vitest-environment jsdom
import type { JobDto } from "@monque/management/contract";
import { render, screen } from "@testing-library/react";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vite-plus/test";

import { JobDetailView } from "@/components/job-detail-view";

describe("job detail heartbeat interval", () => {
  it.each([
    { interval: undefined, label: "Not set" },
    { interval: 0, label: "Not set" },
    { interval: 1500, label: "1500 ms" },
  ])("shows $label for interval $interval", ({ interval, label }) => {
    const job = fromPartial<JobDto>({
      id: "job-123",
      name: "work",
      status: "pending",
      payload: null,
      failCount: 0,
    });

    if (interval !== undefined) {
      job.heartbeatInterval = interval;
    }

    render(<JobDetailView job={job} />);

    expect(screen.getByText("Heartbeat interval").nextElementSibling?.textContent).toBe(label);
  });
});
