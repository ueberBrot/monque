/**
 * Symbol used to store decorator metadata on class constructors.
 *
 * Used by @WorkerController, @Worker, and @Cron decorators to attach
 * metadata that is later collected by MonqueModule during initialization.
 *
 * @example
 * ```typescript
 * Store.from(Class).set(MONQUE, metadata);
 * ```
 */
export const MONQUE = Symbol.for('monque');
