import { formatDashboardDate, formatRelativeDate } from '@/lib/dates';

function JobTimestamp({
	value,
	now,
}: {
	readonly value: string | null | undefined;
	readonly now: Date;
}) {
	if (!value) return <span>Not available</span>;
	return (
		<time dateTime={value} className="block text-xs tabular-nums">
			<span className="block">{formatDashboardDate(value)}</span>
			<span className="block text-muted-foreground">{formatRelativeDate(value, now)}</span>
		</time>
	);
}

export { JobTimestamp };
