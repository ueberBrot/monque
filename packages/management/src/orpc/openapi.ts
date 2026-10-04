import { type OpenAPI, OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { attempt, fromPromise } from "../effects.js";
import { ManagementOpenApiComponentSchemas } from "../schemas/registry.js";
import { managementContract } from "./contract.js";

declare const __MONQUE_MANAGEMENT_PACKAGE_VERSION__: string;

const MANAGEMENT_OPENAPI_VERSION =
  typeof __MONQUE_MANAGEMENT_PACKAGE_VERSION__ === "string"
    ? __MONQUE_MANAGEMENT_PACKAGE_VERSION__
    : "0.0.0";

const generateManagementOpenApi = Effect.fnUntraced(function* () {
  const generator = yield* attempt(
    () =>
      new OpenAPIGenerator({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
  );

  return yield* fromPromise(() =>
    generator.generate(managementContract, {
      info: {
        title: "Monque Management API",
        version: MANAGEMENT_OPENAPI_VERSION,
      },
      customErrorResponseBodySchema: () => ({ $ref: "#/components/schemas/ManagementError" }),
      commonSchemas: ManagementOpenApiComponentSchemas,
    }),
  );
});

const cachedManagementOpenApi = Effect.runSync(
  generateManagementOpenApi().pipe(
    Effect.cachedWithTTL((exit) => (Exit.isSuccess(exit) ? Duration.infinity : 0)),
  ),
);

/**
 * Generate an OpenAPI 3.1 document for the Monque management API.
 *
 * The document includes every v1 route, including mutation routes that may return `403`
 * at runtime when the configured scheduler facade does not support them.
 */
export function generateManagementOpenApiDocument(): Promise<OpenAPI.Document> {
  return Effect.runPromise(cachedManagementOpenApi);
}
