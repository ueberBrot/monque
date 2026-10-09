import { ConnectionError } from "@monque/core";
import { fromPartial, fromAny } from "@total-typescript/shoehorn";
import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MonqueTsedConfig } from "@/config";
import { resolveDatabase } from "@/utils";
import type { MongooseService, InjectorFn } from "@/utils";

// Mock Db instance
const createMockDb = (): Db =>
  fromPartial<Db>({
    databaseName: "test-db",
    collection: vi.fn<Db["collection"]>(),
  });

describe(resolveDatabase, () => {
  describe("direct db strategy", () => {
    it("should return the db instance directly", async () => {
      const mockDb = createMockDb();
      const config: MonqueTsedConfig = { db: mockDb };

      const result = await resolveDatabase(config);

      expect(result).toBe(mockDb);
    });

    it("should prioritize db over other strategies", async () => {
      const mockDb = createMockDb();
      const factoryDb = createMockDb();
      const config: MonqueTsedConfig = {
        db: mockDb,
        dbFactory: () => factoryDb,
      };

      const result = await resolveDatabase(config);

      expect(result).toBe(mockDb);
    });
  });

  describe("dbFactory strategy", () => {
    it("should call sync factory and return result", async () => {
      const mockDb = createMockDb();
      const factory = vi.fn<() => Db | Promise<Db>>().mockReturnValue(mockDb);
      const config: MonqueTsedConfig = { dbFactory: factory };

      const result = await resolveDatabase(config);

      expect(factory).toHaveBeenCalledOnce();
      expect(result).toBe(mockDb);
    });

    it("should call async factory and return result", async () => {
      const mockDb = createMockDb();
      const factory = vi.fn<() => Db | Promise<Db>>().mockResolvedValue(mockDb);
      const config: MonqueTsedConfig = { dbFactory: factory };

      const result = await resolveDatabase(config);

      expect(factory).toHaveBeenCalledOnce();
      expect(result).toBe(mockDb);
    });

    it("should propagate factory errors", async () => {
      const factory = vi
        .fn<() => Db | Promise<Db>>()
        .mockRejectedValue(new Error("Connection failed"));
      const config: MonqueTsedConfig = { dbFactory: factory };

      await expect(resolveDatabase(config)).rejects.toThrow("Connection failed");
    });
  });

  describe("dbToken strategy", () => {
    it("should resolve db from DI token", async () => {
      const mockDb = createMockDb();
      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(mockDb));
      const config: MonqueTsedConfig = { dbToken: "MONGODB_DATABASE" };

      const result = await resolveDatabase(config, injectorFn);

      expect(injectorFn).toHaveBeenCalledWith("MONGODB_DATABASE");
      expect(result).toBe(mockDb);
    });

    it("should throw ConnectionError if injector function is not provided", async () => {
      const config: MonqueTsedConfig = { dbToken: "MONGODB_DATABASE" };

      await expect(resolveDatabase(config)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config)).rejects.toThrow(
        "MonqueTsedConfig.dbToken requires an injector function",
      );
    });

    it("should throw ConnectionError if DI resolution returns undefined", async () => {
      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(undefined));
      const config: MonqueTsedConfig = { dbToken: "MONGODB_DATABASE" };

      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
        /Could not resolve database from token.*MONGODB_DATABASE/u,
      );
    });

    it("should throw ConnectionError if DI resolution returns null", async () => {
      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(null));
      const config: MonqueTsedConfig = { dbToken: "MONGODB_DATABASE" };

      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
        /Could not resolve database from token.*MONGODB_DATABASE/u,
      );
    });

    it("should work with Symbol tokens", async () => {
      const mockDb = createMockDb();
      const TOKEN = Symbol("MONGODB");
      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(mockDb));
      const config: MonqueTsedConfig = { dbToken: TOKEN };

      const result = await resolveDatabase(config, injectorFn);

      expect(injectorFn).toHaveBeenCalledWith(TOKEN);
      expect(result).toBe(mockDb);
    });

    it("should resolve from Mongoose Service (duck typing)", async () => {
      const mockDb = createMockDb();
      // Mock Mongoose Service structure
      const mockMongooseService = {
        get: vi.fn<MongooseService["get"]>().mockReturnValue({
          db: mockDb,
        }),
      };
      const injectorFn: InjectorFn = fromPartial(
        vi.fn<InjectorFn>().mockReturnValue(mockMongooseService),
      );
      const config: MonqueTsedConfig = { dbToken: "MONGOOSE_SERVICE" };

      const result = await resolveDatabase(config, injectorFn);

      expect(injectorFn).toHaveBeenCalledWith("MONGOOSE_SERVICE");
      expect(mockMongooseService.get).toHaveBeenCalledWith("default");
      expect(result).toBe(mockDb);
    });

    it("should resolve from Mongoose Service with custom connection ID", async () => {
      const mockDb = createMockDb();
      const mockMongooseService = {
        get: vi.fn<MongooseService["get"]>().mockImplementation((id) => {
          if (id === "custom-conn") {
            return { db: mockDb };
          }
          return fromAny(null);
        }),
      };
      const injectorFn: InjectorFn = fromPartial(
        vi.fn<InjectorFn>().mockReturnValue(mockMongooseService),
      );
      const config: MonqueTsedConfig = {
        dbToken: "MONGOOSE_SERVICE",
        mongooseConnectionId: "custom-conn",
      };

      const result = await resolveDatabase(config, injectorFn);

      expect(mockMongooseService.get).toHaveBeenCalledWith("custom-conn");
      expect(result).toBe(mockDb);
    });

    it("should resolve from Mongoose Connection (duck typing)", async () => {
      const mockDb = createMockDb();
      // Mock Mongoose Connection structure
      const mockMongooseConnection = {
        db: mockDb,
      };
      const injectorFn: InjectorFn = fromPartial(
        vi.fn<InjectorFn>().mockReturnValue(mockMongooseConnection),
      );
      const config: MonqueTsedConfig = { dbToken: "MONGOOSE_CONNECTION" };

      const result = await resolveDatabase(config, injectorFn);

      expect(injectorFn).toHaveBeenCalledWith("MONGOOSE_CONNECTION");
      expect(result).toBe(mockDb);
    });

    it("should throw ConnectionError if mongoose service returns invalid connection", async () => {
      const mockMongooseService = {
        // Deliberately return a malformed connection.
        get: vi.fn<MongooseService["get"]>().mockReturnValue(fromAny(null)),
      };
      const injectorFn: InjectorFn = fromPartial(
        vi.fn<InjectorFn>().mockReturnValue(mockMongooseService),
      );
      const config: MonqueTsedConfig = { dbToken: "MONGOOSE_SERVICE" };

      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
        /MongooseService resolved from token.*MONGOOSE_SERVICE.*returned no connection/u,
      );
    });

    it("should throw ConnectionError if resolved value is not a valid Db instance", async () => {
      // No collection method.
      const invalidDb = { foo: "bar" };
      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(invalidDb));
      const config: MonqueTsedConfig = { dbToken: "INVALID_DB" };

      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
        /Resolved value from token.*INVALID_DB.*does not appear to be a valid MongoDB Db instance/u,
      );
    });
  });

  describe("no strategy", () => {
    it("should throw ConnectionError if no database strategy is provided", async () => {
      const config: MonqueTsedConfig = {};

      await expect(resolveDatabase(config)).rejects.toThrow(ConnectionError);
      await expect(resolveDatabase(config)).rejects.toThrow(
        "MonqueTsedConfig requires 'db', 'dbFactory', or 'dbToken' to be set",
      );
    });
  });

  describe("priority", () => {
    it("should prioritize db > dbFactory > dbToken", async () => {
      const directDb = createMockDb();
      const factoryDb = createMockDb();
      const tokenDb = createMockDb();

      const injectorFn: InjectorFn = fromPartial(vi.fn<InjectorFn>().mockReturnValue(tokenDb));

      // All three provided - should use db
      const config1: MonqueTsedConfig = {
        db: directDb,
        dbFactory: () => factoryDb,
        dbToken: "TOKEN",
      };
      await expect(resolveDatabase(config1, injectorFn)).resolves.toBe(directDb);

      // Factory and token - should use factory
      const config2: MonqueTsedConfig = {
        dbFactory: () => factoryDb,
        dbToken: "TOKEN",
      };
      await expect(resolveDatabase(config2, injectorFn)).resolves.toBe(factoryDb);
    });
  });
});
