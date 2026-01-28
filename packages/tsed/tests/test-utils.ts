/**
 * Waits for a condition to be true with timeout.
 * Useful for testing async operations like job processing.
 *
 * @param condition - Async function that returns true when condition is met
 * @param options - Configuration for polling and timeout
 * @returns Promise that resolves when condition is true
 * @throws Error if timeout is exceeded
 */
export async function waitFor(
	condition: () => Promise<boolean> | boolean,
	options: { timeout?: number; interval?: number } = {},
): Promise<void> {
	const { timeout = 5000, interval = 50 } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	const elapsed = Date.now() - startTime;
	throw new Error(
		`waitFor condition not met within ${timeout}ms (elapsed: ${elapsed}ms). ` +
			'Consider increasing timeout or checking test conditions.',
	);
}
