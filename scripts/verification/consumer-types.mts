import { Monque } from "@monque/core";
import { createManagementExpressRouter } from "@monque/management-express";
import type { MonqueTsedConfig } from "@monque/tsed";
import type { MongoClient, ObjectId } from "mongodb";

export const checkConsumerTypes = async (client: MongoClient) => {
  const config: MonqueTsedConfig = { db: client.db() };
  const monque = new Monque(client.db());
  const session = client.startSession();
  const job = await monque.enqueue("typed", {}, { session });
  const id: ObjectId = job._id;
  await monque.getJob(id);

  return { config, router: createManagementExpressRouter({ monque }) };
};
