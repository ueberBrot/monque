/**
 * Generate a unique token for a worker controller.
 *
 * Used internally by Ts.ED DI to identify worker controller providers.
 * The token is based on the class name for debugging purposes.
 *
 * @param target - The class constructor
 * @returns A Symbol token unique to this worker controller
 *
 * @example
 * ```typescript
 * @WorkerController("email")
 * class EmailWorkers {}
 *
 * const token = getWorkerToken(EmailWorkers);
 * // Symbol("monque:worker:EmailWorkers")
 * ```
 */
export function getWorkerToken(target: new (...args: unknown[]) => unknown): symbol {
	return Symbol.for(`monque:worker:${target.name}`);
}
