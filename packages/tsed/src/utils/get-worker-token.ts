import { MonqueError } from '@monque/core';

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
	const name = target.name?.trim();

	if (!name) {
		throw new MonqueError('Worker class must have a non-empty name');
	}

	return Symbol.for(`monque:worker:${name}`);
}
