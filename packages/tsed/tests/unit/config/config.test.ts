import { MonqueError } from "@monque/core";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vite-plus/test";

import { validateDatabaseConfig } from "@/config";
import type { MonqueTsedConfig } from "@/config/types";

describe(validateDatabaseConfig, () => {
  it("should pass with exactly one strategy (db)", () => {
    const config = fromPartial<MonqueTsedConfig>({ db: {} });
    expect(() => {
      validateDatabaseConfig(config);
    }).not.toThrow();
  });

  it("should pass with exactly one strategy (dbFactory)", () => {
    const config = fromPartial<MonqueTsedConfig>({ dbFactory: () => ({}) });
    expect(() => {
      validateDatabaseConfig(config);
    }).not.toThrow();
  });

  it("should pass with exactly one strategy (dbToken)", () => {
    const config = fromPartial<MonqueTsedConfig>({ dbToken: Symbol("db") });
    expect(() => {
      validateDatabaseConfig(config);
    }).not.toThrow();
  });

  it("should throw MonqueError if no strategies are provided", () => {
    const config = fromPartial<MonqueTsedConfig>({});
    expect(() => {
      validateDatabaseConfig(config);
    }).toThrow(MonqueError);
    expect(() => {
      validateDatabaseConfig(config);
    }).toThrow(
      "MonqueTsedConfig requires exactly one of 'db', 'dbFactory', or 'dbToken' to be set",
    );
  });

  it("should throw MonqueError if multiple strategies are provided", () => {
    const config = fromPartial<MonqueTsedConfig>({
      db: {},
      dbFactory: () => ({}),
    });

    expect(() => {
      validateDatabaseConfig(config);
    }).toThrow(MonqueError);
    expect(() => {
      validateDatabaseConfig(config);
    }).toThrow(
      "MonqueTsedConfig accepts only one of 'db', 'dbFactory', or 'dbToken' - multiple were provided",
    );
  });
});
