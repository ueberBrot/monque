import { fromAny } from "@total-typescript/shoehorn";
import { ObjectId } from "mongodb";
import type { Document, WithId } from "mongodb";
import { describe, expect, it } from "vite-plus/test";

import { documentToPersistedJob, JobStatus } from "@/jobs";
import { JobFactory } from "@tests/factories";

describe(documentToPersistedJob, () => {
  it("copies only known fields and preserves inherited optional values", () => {
    const original = JobFactory.build();
    const doc: WithId<Document> = { ...original, claimId: undefined, internalOnly: "ignored" };
    let reads = 0;
    Object.setPrototypeOf(doc, {
      get lockedAt() {
        reads += 1;
        return null;
      },
    });
    expect({
      documentToPersistedJobDoc: documentToPersistedJob(doc),
      reads,
    }).toStrictEqual({
      documentToPersistedJobDoc: { ...original, lockedAt: null },
      reads: 2,
    });
  });

  it("preserves explicit null values for nullable fields", () => {
    const original = JobFactory.build({
      lockedAt: null,
      claimedBy: null,
      lastHeartbeat: null,
    });
    const doc = fromAny<WithId<Document>, unknown>(original);
    expect(documentToPersistedJob(doc)).toStrictEqual(original);
  });

  it("maps every populated field and preserves reference identity", () => {
    interface OrderData {
      orderId: string;
      items: string[];
      total: number;
    }
    const data: OrderData = { orderId: "order-123", items: ["item-a", "item-b"], total: 99.99 };
    const now = new Date();
    const doc: WithId<Document> = {
      _id: new ObjectId(),
      name: "test-job",
      data,
      status: JobStatus.PROCESSING,
      priority: 0,
      nextRunAt: now,
      failCount: 3,
      createdAt: now,
      updatedAt: now,
      lockedAt: now,
      claimedBy: "instance-1",
      claimId: "claim-1",
      leaseExpiresAt: now,
      lastHeartbeat: now,
      heartbeatInterval: 5000,
      failReason: "timeout",
      repeatInterval: "0 * * * *",
      timezone: "Europe/Berlin",
      uniqueKey: "dedup-key",
    };
    const result = documentToPersistedJob<OrderData>(doc);
    expect({
      result,
      resultData: Object.is(result.data, data),
      resultLeaseExpiresAt: Object.is(result.leaseExpiresAt, now),
    }).toStrictEqual({
      result: doc,
      resultData: true,
      resultLeaseExpiresAt: true,
    });
  });
});
