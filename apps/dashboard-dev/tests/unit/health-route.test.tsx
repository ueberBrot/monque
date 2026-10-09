// @vitest-environment jsdom
import type { DashboardDevScenarioId } from "@dashboard-dev/mock/scenario-catalog";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { createDashboardHarness } from "../setup/dashboard-harness.js";

const renderHealthRoute = (scenarioId: DashboardDevScenarioId) => {
  createDashboardHarness("/health", {
    scenarioId,
    pollingIntervalMs: 15_000,
    origin: "https://dashboard.example",
  }).render();
};
describe("Health route", () => {
  it("shows scheduler health and Management capabilities", async () => {
    renderHealthRoute("pending-jobs");
    await expect(screen.findByRole("heading", { name: "Health" })).resolves.toBeInstanceOf(
      HTMLElement,
    );
    const labels = [
      "Scheduler healthy",
      "Management API reachable",
      "9 of 9 available",
      "Cancel job",
      "Change job priority",
    ];
    const elements = await Promise.all(labels.map(async (label) => await screen.findByText(label)));
    expect(elements.map((element) => element.textContent)).toStrictEqual(labels);
  });

  it("shows a distinct unauthorized state without a Dashboard login screen", async () => {
    renderHealthRoute("unauthorized");
    await expect(screen.findByText("Authentication required")).resolves.toBeInstanceOf(HTMLElement);
    await expect(
      screen.findByText("Sign in to inspect the dashboard scenario."),
    ).resolves.toBeInstanceOf(HTMLElement);
    expect(screen.queryByText("Dashboard login")).toBeNull();
  });

  it("shows a distinct forbidden state when the operator lacks access", async () => {
    renderHealthRoute("forbidden");
    await expect(screen.findByText("Access denied")).resolves.toBeInstanceOf(HTMLElement);
    await expect(
      screen.findByText("You do not have access to this dashboard scenario."),
    ).resolves.toBeInstanceOf(HTMLElement);
  });

  it("shows capability-disabled actions for a read-only Management surface", async () => {
    renderHealthRoute("read-only");
    await expect(screen.findByText("Read-only access")).resolves.toBeInstanceOf(HTMLElement);
    await expect(screen.findByText("1 of 9 available")).resolves.toBeInstanceOf(HTMLElement);
    const awaitedResult1 = await screen.findAllByText("This dashboard is read-only.");
    expect(awaitedResult1).toHaveLength(9);
    const awaitedResult2 = await screen.findAllByText("Retry selected jobs");
    expect(awaitedResult2.length).toBeGreaterThan(0);
  });

  it("maps generic Management API failures to an operator-facing error state", async () => {
    renderHealthRoute("api-error");
    await expect(screen.findByText("Dashboard data unavailable")).resolves.toBeInstanceOf(
      HTMLElement,
    );
    await expect(
      screen.findByText("Management API unavailable for the current dashboard scenario."),
    ).resolves.toBeInstanceOf(HTMLElement);
  });
});
