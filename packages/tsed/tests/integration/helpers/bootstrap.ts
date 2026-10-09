import { fromPartial, fromAny } from "@total-typescript/shoehorn";
import { Provider } from "@tsed/di";
import type { TokenProvider } from "@tsed/di";
import { MongooseModule, MongooseService } from "@tsed/mongoose";
import { PlatformTest } from "@tsed/platform-http/testing";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

import type { MonqueTsedConfig } from "@/config";
import { ProviderTypes } from "@/constants";
import { MonqueModule } from "@/monque-module";

import { getMongoUrl } from "./mongo-container.js";
import { Server } from "./test-server.js";

interface MongoosePlatformOptions {
  mongoose?: { id: string; url: string; connectionOptions: { directConnection: boolean } }[];
}

type ConnectionStrategy = "dbFactory" | "db" | "mongoose";

interface MonqueTestOptions {
  imports?: unknown[];
  monqueConfig?: Partial<MonqueTsedConfig>;
  connectionStrategy?: ConnectionStrategy;
}

let client: MongoClient | null = null;
let db: Db | null = null;

const uniqueDbName = function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const bootstrapMonque = async function bootstrapMonque(
  options: MonqueTestOptions = {},
): Promise<void> {
  const url = getMongoUrl();

  const { imports = [], monqueConfig = {}, connectionStrategy = "dbFactory" } = options;

  const dbName = uniqueDbName();
  let dbConfig: Partial<MonqueTsedConfig> = {};
  const extraImports: unknown[] = [];
  const platformOptions: MongoosePlatformOptions = {};

  switch (connectionStrategy) {
    case "dbFactory": {
      dbConfig = {
        dbFactory: async () => {
          client = new MongoClient(url, { directConnection: true });
          await client.connect();
          db = client.db(dbName);
          return db;
        },
      };
      break;
    }

    case "db": {
      client = new MongoClient(url, { directConnection: true });
      await client.connect();
      db = client.db(dbName);
      dbConfig = { db };
      break;
    }

    case "mongoose": {
      extraImports.push(MongooseModule);
      platformOptions.mongoose = [
        {
          id: "default",
          url: `${url}/${dbName}`,
          connectionOptions: { directConnection: true },
        },
      ];
      dbConfig = {
        dbToken: fromAny<TokenProvider<Db>, typeof MongooseService>(MongooseService),
        mongooseConnectionId: "default",
      };
      break;
    }
    default: {
      throw new Error("Unsupported database connection strategy");
    }
  }

  const bstrp = PlatformTest.bootstrap(Server, {
    ...platformOptions,
    imports: [MonqueModule, ...extraImports, ...imports],
    monque: {
      enabled: true,
      // Fast safety poll for tests.
      safetyPollInterval: 500,
      ...dbConfig,
      ...monqueConfig,
    },
  });

  await bstrp();
};

export const resetMonque = async function resetMonque(): Promise<void> {
  // Drop the unique db to clean up test data before closing the connection
  if (db) {
    await db.dropDatabase();
  }

  await PlatformTest.reset();
  if (client) {
    await client.close();
    client = null;
    db = null;
  }

  // Clean up GlobalProviders to prevent leaking test controllers
  for (const [key, provider] of Provider.Registry) {
    if (provider.type === ProviderTypes.JOB_CONTROLLER && provider.name.startsWith("Ephemeral")) {
      Provider.Registry.delete(key);
    }
  }
};

export const getTestDb = function getTestDb(): Db {
  if (db) {
    return db;
  }

  try {
    const mongooseService = PlatformTest.get<MongooseService>(MongooseService);
    const conn = mongooseService.get("default");
    if (conn?.db) {
      return fromPartial<Db>(conn.db);
    }
  } catch {
    // Ignore
  }

  throw new Error("Test database not initialized or not accessible");
};
