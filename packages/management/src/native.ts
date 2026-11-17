/* oxlint-disable sonarjs/no-redundant-optional -- Explicit undefined supports live optional facade getters with exactOptionalPropertyTypes. */
import type { Effect } from "effect";

import type {
  ManagementMonque,
  ManagementOptions,
  ManagementAuthorizationInput,
  ManagementPayloadSerializationInput,
} from "./surface/types.js";

type NativeMethod<F, R> = F extends (...args: infer A) => infer B
  ? (...args: A) => Effect.Effect<Awaited<B>, unknown, R>
  : never;

/** Native scheduler dependency. Missing optional methods remain unsupported capabilities. */
export type ManagementEffects<R = never> = {
  [K in keyof ManagementMonque]: K extends "isHealthy"
    ? Effect.Effect<boolean, unknown, R>
    :
        | NativeMethod<ManagementMonque[K], R>
        | (undefined extends ManagementMonque[K] ? undefined : never);
};

/** Hooks run in the caller's Effect context; the host owns provision and request scope. */
export interface NativeManagementOptions<TContext = unknown, R = never> extends Omit<
  ManagementOptions<TContext>,
  // oxlint-disable-next-line sonarjs/max-union-size -- These are the four dependency slots replaced by native Effects.
  "monque" | "authorize" | "serializePayload" | "serializePayloadByJobName"
> {
  monque: ManagementEffects<R>;
  authorize?:
    | ((input: ManagementAuthorizationInput<TContext>) => Effect.Effect<boolean, unknown, R>)
    | undefined;
  serializePayload?:
    | ((input: ManagementPayloadSerializationInput<TContext>) => Effect.Effect<unknown, unknown, R>)
    | undefined;
  serializePayloadByJobName?:
    | Record<
        string,
        (input: ManagementPayloadSerializationInput<TContext>) => Effect.Effect<unknown, unknown, R>
      >
    | undefined;
}
