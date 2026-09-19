import { formatDashboardDate, formatRelativeDate, parseDashboardDate } from '@/lib/dates';
import { useNow } from '@/lib/use-now';

function RelativeTimestamp({ value }: { readonly value: string }) {
	const reference = parseDashboardDate(value)?.getTime();
	const now = useNow(reference);
	return <>{formatRelativeDate(value, now)}</>;
}

function JobTimestamp({ value }: { readonly value: string | null | undefined }) {
	if (!value) return <span>Not available</span>;
	return (
		<time dateTime={value} className="block text-xs tabular-nums">
			<span className="block">{formatDashboardDate(value)}</span>
			<span className="block text-muted-foreground">
				<RelativeTimestamp value={value} />
			</span>
		</time>
	);
}

export { JobTimestamp, RelativeTimestamp };
