import { useCallback, useState, useSyncExternalStore } from 'react';

import { readManagementError } from '@/management-errors';

type PollingQuery = {
	state: { error: unknown; errorUpdateCount: number; dataUpdateCount: number };
};
type PollingInterval = (query: PollingQuery) => number | false;

function subscribeToDocumentVisibility(onStoreChange: () => void): () => void {
	if (typeof document === 'undefined') {
		return () => undefined;
	}

	document.addEventListener('visibilitychange', onStoreChange);

	return () => document.removeEventListener('visibilitychange', onStoreChange);
}

function isDocumentVisible(): boolean {
	if (typeof document === 'undefined') {
		return true;
	}

	return document.visibilityState !== 'hidden';
}

function useDocumentVisible(): boolean {
	return useSyncExternalStore(subscribeToDocumentVisibility, isDocumentVisible, () => true);
}

function useDocumentVisiblePollingInterval(
	pollingIntervalMs: number | undefined,
	cadence = 1,
): PollingInterval {
	const documentVisible = useDocumentVisible();
	const [failures] = useState(
		() => new WeakMap<PollingQuery, { errors: number; successes: number; count: number }>(),
	);
	const [jitter] = useState(() => 1 + Math.random() * 0.1);
	return useCallback(
		(query: PollingQuery) => {
			if (!pollingIntervalMs || !documentVisible) return false;
			const status = readManagementError(query.state.error).status;
			if (status === 401 || status === 403) return false;
			let failure = failures.get(query);
			if (failure && query.state.dataUpdateCount !== failure.successes) {
				failures.delete(query);
				failure = undefined;
			}
			if (
				query.state.error !== null &&
				(!failure || failure.errors !== query.state.errorUpdateCount)
			) {
				failure = {
					errors: query.state.errorUpdateCount,
					successes: query.state.dataUpdateCount,
					count: (failure?.count ?? 0) + 1,
				};
				failures.set(query, failure);
			}
			const backoff = 2 ** Math.min(failure?.count ?? 0, 5);
			return Math.round(pollingIntervalMs * cadence * jitter * backoff);
		},
		[pollingIntervalMs, documentVisible, cadence, jitter, failures],
	);
}

export { isDocumentVisible, useDocumentVisible, useDocumentVisiblePollingInterval };
