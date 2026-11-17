import { OpenAPIGenerator } from "@orpc/openapi";
import type { OpenAPIV3_1 as OpenAPI } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { Duration, Effect, Exit } from "effect";
import { z } from "zod";

import { attempt, fromPromise } from "../effects.js";
import { ManagementOpenApiComponentSchemas } from "../schemas/registry.js";
import { managementContract } from "./contract.js";

declare const __MONQUE_MANAGEMENT_PACKAGE_VERSION__: string;

const MANAGEMENT_OPENAPI_VERSION =
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The build injects this constant; typeof also supports source use where the identifier is absent.
  typeof __MONQUE_MANAGEMENT_PACKAGE_VERSION__ === "string"
    ? __MONQUE_MANAGEMENT_PACKAGE_VERSION__
    : "0.0.0";

const ActionAlternativeSchema = z.object({
  properties: z.object({
    action: z.union([
      z.object({ const: z.string() }),
      z.object({ enum: z.array(z.string()).nonempty() }),
    ]),
  }),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Parse each official JSON Schema alternative before comparing discriminator domains.
const hasDisjointActions = function hasDisjointActions(alternatives: unknown[]): boolean {
  const seen = new Set<string>();

  for (const alternative of alternatives) {
    const parsed = ActionAlternativeSchema.safeParse(alternative);

    if (!parsed.success) {
      return false;
    }

    const { action } = parsed.data.properties;
    const values = "const" in action ? [action.const] : action.enum;

    for (const value of values) {
      if (seen.has(value)) {
        return false;
      }

      seen.add(value);
    }
  }

  return alternatives.length > 0;
};

/** Normalize only schema nodes; example/default values remain application-owned JSON. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, sonarjs/expression-complexity -- Traverse official OpenAPI JSON without imposing a schema on application-owned examples. */
const normalizeOpenApiJson = function normalizeOpenApiJson(
  value: unknown,
  mode: "document" | "schema" | "map" = "document",
): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => normalizeOpenApiJson(child, mode));
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Narrow generated JSON before traversing members.
  if (value === null || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (["example", "examples", "default", "enum", "const"].includes(key)) {
        return [key, child];
      }

      let nextMode = mode;

      if (mode === "map" || key === "schema") {
        nextMode = "schema";
      } else if (key === "schemas") {
        nextMode = "map";
      } else if (mode === "schema" && ["properties", "$defs", "patternProperties"].includes(key)) {
        nextMode = "map";
      }

      return [key, normalizeOpenApiJson(child, nextMode)];
    }),
  );

  if (mode === "schema") {
    if (result["format"] === "date-time") {
      delete result["pattern"];
    }

    if (result["const"] !== undefined) {
      delete result["type"];
    }

    if (Array.isArray(result["oneOf"]) && hasDisjointActions(result["oneOf"])) {
      result["anyOf"] = result["oneOf"];
      delete result["oneOf"];
    }

    if (Array.isArray(result["type"])) {
      result["anyOf"] = result["type"].map((type) => ({ type }));
      delete result["type"];
    }
  }

  if (mode === "document" && result["in"] === "query" && result["name"] === "status") {
    result["explode"] = true;
  }

  return result;
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, sonarjs/expression-complexity */

const generateManagementOpenApi = Effect.fnUntraced(function* generateManagementOpenApi() {
  const names = Object.entries(ManagementOpenApiComponentSchemas);

  const converter = new ZodToJsonSchemaConverter({
    override(ctx) {
      const name = names.find(([, { schema }]) => schema === ctx.zodSchema)?.[0];

      if (name !== undefined && ctx.path.length > 0) {
        // Zod invokes this after populating the schema; replace it with the public component reference.
        // oxlint-disable-next-line typescript/no-dynamic-delete -- JSON Schema keys must be removed before replacing the node with a reference.
        for (const key of Object.keys(ctx.jsonSchema)) {
          // oxlint-disable-next-line typescript/no-dynamic-delete -- Replace generated schema members with a stable reference.
          delete ctx.jsonSchema[key];
        }

        ctx.jsonSchema.$ref = `#/components/schemas/${name}`;
      }
    },
  });

  const generator = yield* attempt(
    () =>
      new OpenAPIGenerator({
        converters: [
          {
            condition: converter.condition.bind(converter),
            convert(schema, direction) {
              const [json, optional] = converter.convert(schema, direction);

              const name = Object.entries(ManagementOpenApiComponentSchemas).find(
                ([, value]) => value.schema === schema,
              )?.[0];

              if (name === undefined) {
                return [json, optional];
              }

              return [{ $ref: `#/components/schemas/${name}` }, optional];
            },
          },
        ],
      }),
  );

  const document = yield* fromPromise(
    async () =>
      await generator.generate(managementContract, {
        version: "3.1.1",
        base: {
          components: {
            schemas: Object.fromEntries(
              names.map(([name, { schema }]) => [name, converter.convert(schema, "output")[0]]),
            ),
          },
          info: {
            title: "Monque Management API",
            version: MANAGEMENT_OPENAPI_VERSION,
          },
        },
        customErrorResponseBodySchema: () => ({ $ref: "#/components/schemas/ManagementError" }),
      }),
  );

  // Keep the cached document identity while normalizing its JSON representation.
  return Object.assign(document, normalizeOpenApiJson(document));
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
