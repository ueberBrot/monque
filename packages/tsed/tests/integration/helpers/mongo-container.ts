import { inject } from 'vitest';

declare module 'vitest' {
	export interface ProvidedContext {
		tsedMongoUri: string;
	}
}

export function getMongoUrl(): string {
	const uri = inject('tsedMongoUri');
	if (!uri) throw new Error('MongoDB global setup has not provided tsedMongoUri');
	return uri;
}
