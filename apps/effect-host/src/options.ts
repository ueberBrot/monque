import type { MonqueInstrumentation } from "@monque/core";
import { Config, Effect, Schema } from "effect";

import { HostError } from "./host-error.js";

export interface HostOptions {
  readonly mongoUri: string;
  readonly databaseName: string;
  readonly operatorPassword: string;
  readonly viewerPassword: string;
  readonly managementPath: string;
  readonly dashboardPath: string;
  readonly port: number;
  readonly readOnly?: boolean;
  readonly instrumentation?: MonqueInstrumentation;
}

export const configuration = Config.all({
  mongoUri: Config.String("MONGO_URI").pipe(
    Config.withDefault("mongodb://127.0.0.1:27017/?directConnection=true"),
  ),
  databaseName: Config.String("MONGO_DATABASE").pipe(Config.withDefault("monque_effect_example")),
  operatorPassword: Config.String("OPERATOR_PASSWORD"),
  viewerPassword: Config.String("VIEWER_PASSWORD"),
  managementPath: Config.String("MANAGEMENT_PATH").pipe(Config.withDefault("/ops/control")),
  dashboardPath: Config.String("DASHBOARD_PATH").pipe(Config.withDefault("/ops/dashboard")),
  port: Config.Number("PORT").pipe(Config.withDefault(3000)),
  readOnly: Config.Boolean("READ_ONLY").pipe(Config.withDefault(false)),
  tracing: Config.Boolean("MONQUE_TRACING").pipe(Config.withDefault(false)),
});

const mountPath = Schema.String.check(Schema.isPattern(/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/u));

const settings = Schema.Struct({
  operatorPassword: Schema.String.check(Schema.isNonEmpty()),
  viewerPassword: Schema.String.check(Schema.isNonEmpty()),
  managementPath: mountPath,
  dashboardPath: mountPath,
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65_535 })),
});

export const validateOptions = (options: HostOptions) =>
  Effect.gen(function* validateHostOptions() {
    yield* Schema.decodeEffect(settings)(options).pipe(
      Effect.mapError(
        (cause) => new HostError({ message: `Invalid host settings: ${cause.message}` }),
      ),
    );

    if (
      options.managementPath === options.dashboardPath ||
      options.managementPath.startsWith(`${options.dashboardPath}/`) ||
      options.dashboardPath.startsWith(`${options.managementPath}/`)
    ) {
      return yield* new HostError({ message: "Management and Dashboard mounts must not overlap" });
    }

    return yield* Effect.void;
  });
