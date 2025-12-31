/**
 * Dependency Injection tokens for Monque components
 */
export enum MonqueTypes {
	/**
	 * Token used to identify Job providers in the DI container
	 */
	JOB = 'monque:job',

	/**
	 * Token used to identify JobController providers in the DI container.
	 * Controllers group related job handlers with optional namespace prefixing.
	 */
	CONTROLLER = 'monque:controller',
}
