import { useCallback, useSyncExternalStore } from 'react';

/** Subscribe once per consumer; resize updates only when the breakpoint changes. */
export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const media = window.matchMedia(query);
			media.addEventListener('change', onChange);
			return () => media.removeEventListener('change', onChange);
		},
		[query],
	);
	const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
	return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
