/**
 * Normalize an unknown caught value into a proper `Error` instance.
 *
 * In JavaScript, any value can be thrown — strings, numbers, objects, `undefined`, etc.
 * This function ensures we always have a real `Error` with a proper stack trace and message.
 *
 * @param value - The caught value (typically from a `catch` block typed as `unknown`).
 * @returns The original value if already an `Error`, otherwise a new `Error` wrapping `String(value)`.
 *
 * @example
 * ```ts
 * try {
 *   riskyOperation();
 * } catch (error: unknown) {
 *   const normalized = toError(error);
 *   console.error(normalized.message);
 * }
 * ```
 *
 * @internal
 */
export function toError(value: unknown): Error {
	if (value instanceof Error) return value;

	return new Error(String(value));
}
