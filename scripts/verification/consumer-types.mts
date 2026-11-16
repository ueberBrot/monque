import { Monque, MonqueEffect } from "@monque/core";
import { createManagementExpressRouter } from "@monque/management-express";
import type { MonqueTsedConfig } from "@monque/tsed";
import { Effect } from "effect";
import type { MongoClient, ObjectId } from "mongodb";

export const checkConsumerTypes = async (client: MongoClient) => {
  const config: MonqueTsedConfig = { db: client.db() };
  const monque = new Monque(client.db());
  const session = client.startSession();
  const job = await monque.enqueue("typed", {}, { session });
  const id: ObjectId = job._id;
  await monque.getJob(id);

  const native = MonqueEffect.use((scheduler) => scheduler.enqueue("typed", {})).pipe(
    Effect.provide(MonqueEffect.layer(client.db())),
  );

  return { native, config, router: createManagementExpressRouter({ monque }) };
};
