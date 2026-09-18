import { useSyncExternalStore } from 'react';

function subscribeToClock(onChange: () => void): () => void {
	const update = () => {
		if (document.visibilityState !== 'hidden') onChange();
	};
	const interval = setInterval(update, 1_000);
	document.addEventListener('visibilitychange', update);
	return () => {
		clearInterval(interval);
		document.removeEventListener('visibilitychange', update);
	};
}

function getClockSnapshot(): number {
	// A stable snapshot within each displayed second, refreshed on render as well as timer ticks.
	return Math.floor(Date.now() / 1_000) * 1_000;
}

/** Relative labels tick locally without refetching jobs. */
function useNow(): Date {
	const timestamp = useSyncExternalStore(subscribeToClock, getClockSnapshot, () => 0);
	return new Date(timestamp);
}

export { useNow };
