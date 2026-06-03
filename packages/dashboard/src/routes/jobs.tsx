import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

export const Route = createFileRoute('/jobs')({
	component: JobsRoute,
});

function JobsRoute() {
	const pathname = useLocation().pathname;

	if (pathname !== '/jobs') {
		return <Outlet />;
	}

	return (
		<section className="grid gap-2">
			<h1 className="text-2xl font-semibold">Jobs</h1>
			<p className="max-w-prose text-sm text-muted-foreground">
				Jobs route shell. Table wiring lands in #461.
			</p>
		</section>
	);
}
