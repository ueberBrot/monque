import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const packScript = join(repository, 'scripts/pack-release.ts');
const changesetCli = join(repository, 'node_modules/@changesets/cli/bin.js');
let directory: string;

function run(command: string, args: string[]): string {
	return execFileSync(command, args, {
		cwd: directory,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${join(directory, 'bin')}:${process.env['PATH']}`,
			RELEASE_TEST_CHANGESET_CLI: changesetCli,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(join(directory, path), JSON.stringify(value));
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'monque-release-test-'));
	await Promise.all(
		['packages/a', 'packages/b', '.changeset', 'bin'].map((path) =>
			mkdir(join(directory, path), { recursive: true }),
		),
	);
	const root = z
		.object({ scripts: z.object({ 'release:version': z.string() }) })
		.parse(JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')));
	await writeJson('package.json', {
		name: 'release-fixture',
		private: true,
		workspaces: ['packages/*'],
		scripts: { 'release:version': root.scripts['release:version'] },
	});
	for (const name of ['a', 'b']) {
		await writeJson(`packages/${name}/package.json`, {
			name: `@release-fixture/${name}`,
			version: '0.0.0',
			...(name === 'b' ? { dependencies: { '@release-fixture/a': 'workspace:*' } } : {}),
		});
	}
	await writeJson('.changeset/config.json', {
		changelog: false,
		commit: false,
		fixed: [],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
		ignore: [],
	});
	// Only registry discovery is stubbed. Versioning and tarball creation use the real CLIs.
	await writeFile(
		join(directory, 'bin/bunx'),
		`#!/bin/sh
if [ "$2" = publish-plan ]; then
  mkdir -p .release
  cp fixture-plan.json "$4"
else
  shift
  exec node "$RELEASE_TEST_CHANGESET_CLI" "$@"
fi
`,
	);
	await chmod(join(directory, 'bin/bunx'), 0o755);
	run('bun', ['install', '--lockfile-only', '--ignore-scripts']);
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe('release tooling', () => {
	it('refreshes version-only lockfile changes and packs resolved dependencies in plan order', async () => {
		await writeFile(
			join(directory, '.changeset/release.md'),
			'---\n"@release-fixture/a": minor\n"@release-fixture/b": minor\n---\nInitial release.\n',
		);
		run('bun', ['run', 'release:version']);
		const plan = ['a', 'b'].map((name) => [
			{
				kind: 'publish',
				name: `@release-fixture/${name}`,
				version: '0.1.0',
				access: 'public',
				tag: 'latest',
			},
		]);
		await writeJson('fixture-plan.json', { version: 1, plan });
		run('bun', [packScript]);
		const packed = z
			.object({
				plan: z.array(
					z.array(
						z.object({
							kind: z.literal('publish'),
							name: z.string(),
							version: z.string(),
							access: z.string(),
							tag: z.string(),
							tarball: z.object({ path: z.string(), integrity: z.string() }),
						}),
					),
				),
			})
			.parse(JSON.parse(await readFile(join(directory, '.release/publish-plan.json'), 'utf8')));
		expect(packed.plan).toHaveLength(plan.length);
		for (const [index, group] of packed.plan.entries()) {
			const entry = group[0];
			if (!entry) throw new Error('Expected a publish entry');
			const { tarball, ...release } = entry;
			expect(release).toEqual(plan[index]?.[0]);
			const tarballPath = join(directory, '.release', tarball.path);
			expect(tarball.integrity).toBe(
				`sha256-${createHash('sha256')
					.update(await readFile(tarballPath))
					.digest('base64')}`,
			);
			const manifest = z
				.object({
					name: z.string(),
					version: z.string(),
					dependencies: z.record(z.string(), z.string()).optional(),
				})
				.parse(JSON.parse(run('tar', ['-xOf', tarballPath, 'package/package.json'])));
			expect(manifest.name).toBe(release.name);
			expect(manifest.version).toBe('0.1.0');
			if (manifest.name === '@release-fixture/b') {
				expect(manifest.dependencies?.['@release-fixture/a']).toBe('0.1.0');
			}
		}
	});

	it('does not select stale artifacts when Changesets has nothing to publish', async () => {
		await mkdir(join(directory, '.release/packages'), { recursive: true });
		await writeFile(join(directory, '.release/packages/stale.tgz'), 'stale');
		await writeJson('fixture-plan.json', { version: 1, plan: [] });
		run('bun', [packScript]);
		expect(
			JSON.parse(await readFile(join(directory, '.release/publish-plan.json'), 'utf8')),
		).toEqual({
			version: 1,
			plan: [],
		});
	});
});
