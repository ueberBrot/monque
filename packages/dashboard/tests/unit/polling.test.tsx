// @vitest-environment jsdom
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { describe, afterEach, expect, it, vi } from "vite-plus/test";

import { useDocumentVisiblePollingInterval } from "@/lib/document-visibility";
import { createDashboardQueryClient } from "@/query-client";

const PollingProbe = ({
  requests,
  started,
  pollingIntervalMs = 100,
  cadence = 1,
  failures = 3,
}: {
  requests: number[];
  started: number;
  pollingIntervalMs?: number;
  cadence?: number;
  failures?: number;
}) => {
  const refetchInterval = useDocumentVisiblePollingInterval(pollingIntervalMs, cadence);
  useQuery({
    queryKey: ["polling"],
    refetchInterval,
    queryFn: async () => {
      requests.push(Date.now() - started);

      if (requests.length <= failures) {
        throw new Error("Unavailable");
      }

      return await Promise.resolve("recovered");
    },
  });

  return null;
};

describe("polling", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { label: "jitter", pollingIntervalMs: 2_147_483_647, cadence: 1, failures: 0 },
    { label: "cadence", pollingIntervalMs: 1_000_000_000, cadence: 3, failures: 0 },
    { label: "backoff", pollingIntervalMs: 2_000_000_000, cadence: 1, failures: 1 },
    {
      label: "the largest configured interval",
      pollingIntervalMs: Number.MAX_SAFE_INTEGER,
      cadence: 6,
      failures: 0,
    },
  ])("avoids rapid polling when $label exceeds the timer limit", async (options) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const requests: number[] = [];
    const client = createDashboardQueryClient();

    render(
      <QueryClientProvider client={client}>
        <PollingProbe requests={requests} started={Date.now()} {...options} />
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });

    expect(requests).toHaveLength(1);
    client.clear();
  });

  it("backs off repeated failed polls and restores the interval after recovery", async () => {
    vi.useFakeTimers();
    const requests: number[] = [];
    const started = Date.now();
    const client = createDashboardQueryClient();
    render(
      <QueryClientProvider client={client}>
        <PollingProbe requests={requests} started={started} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const gaps = requests.slice(1).map((time, i) => time - (requests[i] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(200);
    expect(gaps[1]).toBeGreaterThanOrEqual(400);
    expect(gaps[2]).toBeGreaterThanOrEqual(800);
    expect(gaps[3]).toBeGreaterThanOrEqual(100);
    expect(gaps[3]).toBeLessThanOrEqual(110);
    client.clear();
  });
});
