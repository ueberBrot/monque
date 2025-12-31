/**
 * Get the DI token for a job.
 * @param name The job name
 * @returns The job token
 */
export function getJobToken(name: string): string {
	return `monque:job:${name}`;
}
