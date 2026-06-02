import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/health')({
	component: HealthRoute,
});

function HealthRoute() {
	return (
		<section className="grid gap-2">
			<h1 className="text-2xl font-semibold">Health</h1>
			<p className="max-w-prose text-sm text-muted-foreground">
				Health route shell. Capabilities wiring lands in #462.
			</p>
		</section>
	);
}
