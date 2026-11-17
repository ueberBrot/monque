import { OpenAPIGenerator } from "@orpc/openapi";
import type { OpenAPIV3_1 as OpenAPI } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { Duration, Effect, Exit } from "effect";

import { attempt, fromPromise } from "../effects.js";
import { managementContract } from "./contract.js";

declare const __MONQUE_MANAGEMENT_PACKAGE_VERSION__: string;

const MANAGEMENT_OPENAPI_VERSION =
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The build injects this constant; typeof also supports source use where the identifier is absent.
  typeof __MONQUE_MANAGEMENT_PACKAGE_VERSION__ === "string"
    ? __MONQUE_MANAGEMENT_PACKAGE_VERSION__
    : "0.0.0";

const generateManagementOpenApi = Effect.fnUntraced(function* generateManagementOpenApi() {
  const generator = yield* attempt(
    () => new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] }),
  );

  return yield* fromPromise(
    async () =>
      await generator.generate(managementContract, {
        version: "3.1.1",
        base: {
          info: {
            title: "Monque Management API",
            version: MANAGEMENT_OPENAPI_VERSION,
          },
        },
        errorResponseBodySchema: () => ({ $ref: "#/components/schemas/ManagementError" }),
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
export const generateManagementOpenApiDocument =
  async function generateManagementOpenApiDocument(): Promise<OpenAPI.OpenAPIObject> {
    return await Effect.runPromise(cachedManagementOpenApi);
  };
