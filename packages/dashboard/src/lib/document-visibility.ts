import { useSyncExternalStore } from 'react';

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

export { isDocumentVisible, useDocumentVisible };
