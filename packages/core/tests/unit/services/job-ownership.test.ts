import { Effect } from "effect";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { JobOwnership, makeNativeJobOwnershipLayer } from "@/scheduler/services/job-ownership.js";
import { JobPersistenceError } from "@/scheduler/services/job-persistence-error.js";
import { createMockContext } from "@tests/factories";

describe("Claim persistence", () => {
  it("retains a native claim failure without retrying the write", async () => {
    const ctx = createMockContext();
    const failure = new MongoServerError({ message: "Claim unavailable", code: 91 });
    failure.addErrorLabel("RetryableWriteError");
    const write = vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValue(failure);

    const error = await Effect.runPromise(
      JobOwnership.use((store) => store.claimNext("work")).pipe(
        Effect.provide(makeNativeJobOwnershipLayer(ctx.collection, ctx.instanceId, ctx.options)),
        Effect.flip,
      ),
    );

    expect(error).toBeInstanceOf(JobPersistenceError);
    expect(error.cause).toBe(failure);
    expect(failure.hasErrorLabel("RetryableWriteError")).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });
});
