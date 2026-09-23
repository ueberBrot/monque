import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const outputDirectory = resolve('.release');
const planPath = resolve(outputDirectory, 'publish-plan.json');

const packageSchema = z.object({
	name: z.string(),
	version: z.string(),
	private: z.boolean().optional(),
});
const planSchema = z.object({
	version: z.literal(1),
	plan: z.array(
		z.array(
			z.looseObject({
				kind: z.enum(['publish', 'tag-only']),
				name: z.string(),
				version: z.string(),
			}),
		),
	),
});

// Let Changesets select unpublished versions and order dependencies for us.
execFileSync('bunx', ['changeset', 'publish-plan', '--output', planPath], { stdio: 'inherit' });
const plan = planSchema.parse(JSON.parse(await readFile(planPath, 'utf8')));
const root = z
	.object({ workspaces: z.array(z.string()) })
	.parse(JSON.parse(await readFile('package.json', 'utf8')));
const packages = new Map<string, { directory: string; version: string }>();

for await (const manifestPath of glob(
	root.workspaces.map((workspace) => `${workspace}/package.json`),
)) {
	const manifest = packageSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
	if (!manifest.private) {
		packages.set(manifest.name, { directory: dirname(manifestPath), version: manifest.version });
	}
}

await mkdir(resolve(outputDirectory, 'packages'), { recursive: true });
for (const group of plan.plan) {
	for (const release of group) {
		if (release.kind !== 'publish') continue;
		const pkg = packages.get(release.name);
		if (!pkg || pkg.version !== release.version) {
			throw new Error(`Publish plan does not match workspace: ${release.name}@${release.version}`);
		}

		const filename = `${release.name.replace(/^@/, '').replace('/', '-')}-${release.version}.tgz`;
		const tarballPath = resolve(outputDirectory, 'packages', filename);
		// Bun resolves workspace: dependencies; npm remains responsible for OIDC publishing.
		execFileSync('bun', ['pm', 'pack', '--filename', tarballPath], {
			cwd: pkg.directory,
			stdio: 'inherit',
		});
		release['tarball'] = {
			path: `packages/${filename}`,
			integrity: `sha256-${createHash('sha256')
				.update(await readFile(tarballPath))
				.digest('base64')}`,
		};
	}
}

await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
