// @vitest-environment jsdom
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { describe, afterEach, expect, it, vi } from "vite-plus/test";

import { useDocumentVisiblePollingInterval } from "@/lib/document-visibility";
import { createDashboardQueryClient } from "@/query-client";

const PollingProbe = ({ requests, started }: { requests: number[]; started: number }) => {
  const refetchInterval = useDocumentVisiblePollingInterval(100);
  useQuery({
    queryKey: ["polling"],
    refetchInterval,
    queryFn: async () => {
      requests.push(Date.now() - started);
      if (requests.length < 4) {
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
