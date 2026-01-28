/**
 * Build the full job name by combining namespace and name.
 *
 * @param namespace - Optional namespace from @WorkerController
 * @param name - Job name from @Worker or @Cron
 * @returns Full job name (e.g., "email.send" or just "send")
 *
 * @example
 * ```typescript
 * buildJobName("email", "send"); // "email.send"
 * buildJobName(undefined, "send"); // "send"
 * buildJobName("", "send"); // "send"
 * ```
 */
export function buildJobName(namespace: string | undefined, name: string): string {
	return namespace ? `${namespace}.${name}` : name;
}
