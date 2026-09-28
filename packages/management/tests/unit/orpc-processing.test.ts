import { Monque } from "@monque/core";
import { MongoClient } from "mongodb";
import { describe, expect, test } from "vite-plus/test";

import { createManagementSurface } from "@/index";

import {
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
  handleManagementPost,
} from "./management-test-utils.js";

// Processing controls need no connection or initialized collection.
function createScheduler(): Monque {
  return new Monque(new MongoClient("mongodb://localhost:27017").db("processing-controls"));
}

describe("local processing controls", () => {
  test("returns only public processing fields from a custom facade", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getProcessingState: () => ({
          instanceId: "custom",
          paused: false,
          globallyPaused: false,
          privateSetting: "hidden",
        }),
      }),
    });
    await expectJsonResponse(await handleManagementGet(surface, "/api/v1/processing"), 200, {
      instanceId: "custom",
      paused: false,
      globallyPaused: false,
    });
  });
  test("preserves worker pauses across global resume and reports the effective state", async () => {
    const monque = createScheduler();
    const surface = createManagementSurface({ monque });
    const initial = await handleManagementGet(surface, "/api/v1/processing");
    const { instanceId } = monque.getProcessingState();
    await expectJsonResponse(initial, 200, { instanceId, paused: false, globallyPaused: false });
    for (const body of [{ instanceId, name: "email" }, { instanceId }]) {
      expect(
        (await handleManagementPost(surface, "/api/v1/processing/actions/pause", body)).status,
      ).toBe(200);
    }
    await expectJsonResponse(
      await handleManagementPost(surface, "/api/v1/processing/actions/resume", { instanceId }),
      200,
      {
        instanceId,
        paused: false,
        globallyPaused: false,
      },
    );
    await expectJsonResponse(
      await handleManagementGet(surface, "/api/v1/processing?name=email"),
      200,
      {
        instanceId,
        name: "email",
        paused: true,
        globallyPaused: false,
      },
    );
    await expectJsonResponse(
      await handleManagementPost(surface, "/api/v1/processing/actions/resume", {
        instanceId,
        name: "email",
      }),
      200,
      {
        instanceId,
        name: "email",
        paused: false,
        globallyPaused: false,
      },
    );
    expect(monque.isPaused("email")).toBe(false);
  });

  test("rejects a different scheduler identity without changing processing", async () => {
    const monque = createScheduler();
    const surface = createManagementSurface({ monque });
    await expectJsonResponse(
      await handleManagementPost(surface, "/api/v1/processing/actions/pause", {
        instanceId: createScheduler().getProcessingState().instanceId,
      }),
      409,
      { error: "Scheduler instance changed; refresh before retrying" },
    );
    expect(monque.isPaused()).toBe(false);
  });

  test("authorizes the worker name and scheduler identity and denies unapproved scopes", async () => {
    const monque = createScheduler();
    const { instanceId } = monque.getProcessingState();
    const surface = createManagementSurface({
      monque,
      authorize: ({ action, name, instanceId: target }) =>
        action === "read" || (name === "email" && target === instanceId),
    });
    const scoped = await handleManagementGet(surface, "/api/v1/capabilities?name=email");
    expect(await scoped.json()).toMatchObject({ actions: { pause: true, resume: true } });
    const global = await handleManagementGet(surface, "/api/v1/capabilities");
    expect(await global.json()).toMatchObject({ actions: { pause: false, resume: false } });
    expect(
      (
        await handleManagementPost(surface, "/api/v1/processing/actions/pause", {
          instanceId,
          name: "email",
        })
      ).status,
    ).toBe(200);
    expect(monque.isPaused("email")).toBe(true);
    expect(
      (await handleManagementPost(surface, "/api/v1/processing/actions/pause", { instanceId }))
        .status,
    ).toBe(403);
    expect(monque.isPaused()).toBe(false);
  });

  test("denies state reads when read authorization fails", async () => {
    const surface = createManagementSurface({ monque: createScheduler(), authorize: () => false });
    expect((await handleManagementGet(surface, "/api/v1/processing")).status).toBe(403);
  });

  test.each(["pause", "resume"])("enforces read-only mode for %s", async (action) => {
    const monque = createScheduler();
    monque.pause("email");
    const surface = createManagementSurface({ monque, readOnly: true });
    expect(
      (
        await handleManagementPost(surface, `/api/v1/processing/actions/${action}`, {
          instanceId: monque.getProcessingState().instanceId,
          name: "email",
        })
      ).status,
    ).toBe(403);
    expect(monque.isPaused("email")).toBe(true);
    const capabilities = await handleManagementGet(surface, "/api/v1/capabilities");
    expect(await capabilities.json()).toMatchObject({ actions: { pause: false, resume: false } });
  });

  test("keeps older facades usable while reporting processing controls unsupported", async () => {
    const surface = createManagementSurface({ monque: createManagementMonque() });
    expect((await handleManagementGet(surface, "/api/v1/processing")).status).toBe(403);
    expect(
      (
        await handleManagementPost(surface, "/api/v1/processing/actions/pause", {
          instanceId: "old",
        })
      ).status,
    ).toBe(403);
  });

  test.each([
    {},
    { instanceId: "" },
    { instanceId: "test", name: "" },
    { instanceId: "test", name: "   " },
  ])("rejects malformed control requests %j", async (body) => {
    const monque = createScheduler();
    const surface = createManagementSurface({ monque });
    expect(
      (await handleManagementPost(surface, "/api/v1/processing/actions/pause", body)).status,
    ).toBe(400);
    expect(monque.isPaused()).toBe(false);
  });
});
