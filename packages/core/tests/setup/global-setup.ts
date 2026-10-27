import type { TestProject } from "vite-plus/test/node";

import { DiagnosticMongoDBContainer } from "./diagnostic-mongodb-container";

/** One container per Vitest project; workers own only their client connections. */
export const setup = async (project: TestProject): Promise<() => Promise<void>> => {
  const reuse = process.env["TESTCONTAINERS_REUSE_ENABLE"] === "true";
  const mongo = new DiagnosticMongoDBContainer("mongo:8");
  const container = await (reuse ? mongo.withReuse() : mongo).start();
  project.provide("coreMongoUri", container.getConnectionString());
  return async () => {
    if (!reuse) {
      await container.stop();
    }
  };
};
