import { MongoClient } from "mongodb";
import { inject } from "vite-plus/test";

let clientPromise: Promise<MongoClient> | undefined;
const connectMongoClient = async (client: MongoClient): Promise<MongoClient> => {
  try {
    return await client.connect();
  } catch (error) {
    clientPromise = undefined;
    await client.close();
    throw error;
  }
};

/** Share one connected client within a test file, including concurrent callers. */
export const getMongoClient = async (): Promise<MongoClient> => {
  if (!clientPromise) {
    const uri = inject("coreMongoUri");
    if (!uri) {
      throw new Error("MongoDB global setup has not provided coreMongoUri");
    }
    const client = new MongoClient(uri, { directConnection: true });
    clientPromise = connectMongoClient(client);
  }
  return await clientPromise;
};
/** Called after the file's suites have stopped schedulers and dropped their databases. */
export const closeMongoDb = async (): Promise<void> => {
  const pending = clientPromise;
  clientPromise = undefined;
  if (pending) {
    const awaitedResult1 = await pending;
    await awaitedResult1.close();
  }
};
declare module "vitest" {
  export interface ProvidedContext {
    coreMongoUri: string;
  }
}
