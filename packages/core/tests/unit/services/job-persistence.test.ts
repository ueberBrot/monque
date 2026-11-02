import { fromPartial } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import type { Collection } from "mongodb";
import { MongoServerError, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { JobPersistenceError } from "@/scheduler/services/job-persistence-error.js";
import {
  JobPersistence,
  makeNativeJobPersistenceLayer,
} from "@/scheduler/services/job-persistence.js";
import type { MockFunction } from "@tests/setup/mock-function.js";

describe("native Job persistence failures", () => {
  it.each([new MongoServerError({ message: "Read unavailable", code: 91 }), "Read unavailable"])(
    "retains the original driver rejection in the typed error: %s",
    async (failure) => {
      const collection = fromPartial<Collection>({
        findOne: vi.fn<MockFunction<Collection["findOne"]>>().mockRejectedValue(failure),
      });

      const error = await Effect.runPromise(
        JobPersistence.use((store) => store.getJob(new ObjectId())).pipe(
          Effect.provide(makeNativeJobPersistenceLayer(collection)),
          Effect.flip,
        ),
      );

      expect(error).toBeInstanceOf(JobPersistenceError);
      expect(error.cause).toBe(failure);
    },
  );
});
