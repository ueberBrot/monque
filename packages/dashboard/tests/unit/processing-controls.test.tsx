// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { ProcessingControls } from "@/components/processing-controls";
import { createDashboardManagementApi } from "@/management-client";
import { createDashboardQueryClient } from "@/query-client";

function renderControls(
  options: { readOnly?: boolean; globallyPaused?: boolean; conflict?: boolean } = {},
) {
  let paused = options.globallyPaused ?? false;
  const requests: { pathname: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/capabilities")) {
      expect(url.searchParams.get("name")).toBe("email");
      return Response.json({
        readOnly: options.readOnly ?? false,
        actions: { read: true, pause: !options.readOnly, resume: !options.readOnly },
      });
    }
    if (request.method === "POST") {
      requests.push({ pathname: url.pathname, body: await request.json() });
      if (options.conflict)
        return Response.json(
          { error: "Scheduler instance changed; refresh before retrying" },
          { status: 409 },
        );
      paused = url.pathname.endsWith("/pause");
    }
    return Response.json({
      instanceId: "scheduler-1",
      name: "email",
      paused,
      globallyPaused: options.globallyPaused ?? false,
    });
  };
  const api = createDashboardManagementApi({ apiBaseUrl: "https://management.test", fetch });
  render(
    <QueryClientProvider client={createDashboardQueryClient()}>
      <ProcessingControls managementApi={api} name="email" />
    </QueryClientProvider>,
  );
  return requests;
}

describe("processing controls", () => {
  it("sends the displayed instance and worker, then refreshes the state after pause and resume", async () => {
    const requests = renderControls();
    fireEvent.click(await screen.findByRole("button", { name: "Pause worker" }));
    const resume = await screen.findByRole("button", { name: "Resume worker" });
    await waitFor(() => expect(resume.hasAttribute("disabled")).toBe(false));
    fireEvent.click(resume);
    await screen.findByRole("button", { name: "Pause worker" });
    expect(requests).toEqual([
      {
        pathname: "/api/v1/processing/actions/pause",
        body: { instanceId: "scheduler-1", name: "email" },
      },
      {
        pathname: "/api/v1/processing/actions/resume",
        body: { instanceId: "scheduler-1", name: "email" },
      },
    ]);
  });

  it("explains read-only controls and sends no mutation", async () => {
    const requests = renderControls({ readOnly: true });
    const button = await screen.findByRole("button", { name: "Pause worker" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(screen.getByText("This dashboard is read-only.")).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("explains why a globally paused worker cannot be resumed here", async () => {
    const requests = renderControls({ globallyPaused: true });
    const button = await screen.findByRole("button", { name: "Resume worker" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Instance paused. Resume it from Health.")).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("shows the instance conflict without retrying a mutation", async () => {
    const requests = renderControls({ conflict: true });
    fireEvent.click(await screen.findByRole("button", { name: "Pause worker" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Scheduler instance changed");
    expect(requests).toHaveLength(1);
  });
});
