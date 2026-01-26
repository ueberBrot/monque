import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function sh(cmd: string, args: string[]): string {
	return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function extractFirstSemver(
	value: unknown,
): { major: number; minor: number; patch: number } | null {
	if (typeof value !== 'string') return null;
	const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

type BumpType = 'patch' | 'minor' | 'major';

function semverDiffType(from: unknown, to: unknown): BumpType {
	const a = extractFirstSemver(from);
	const b = extractFirstSemver(to);
	if (!a || !b) return 'patch';
	if (b.major !== a.major) return 'major';
	if (b.minor !== a.minor) return 'minor';
	if (b.patch !== a.patch) return 'patch';
	return 'patch';
}

function maxBump(current: BumpType, next: BumpType): BumpType {
	const order: Record<BumpType, number> = { patch: 0, minor: 1, major: 2 };
	return order[next] > order[current] ? next : current;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
	try {
		const raw = await readFile(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function readJsonAt(ref: string, filePath: string): unknown | null {
	try {
		const raw = sh('git', ['show', `${ref}:${filePath}`]);
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

async function main(): Promise<void> {
	const baseSha = process.env.BASE_SHA;
	const headSha = process.env.HEAD_SHA;

	if (!baseSha || !headSha) {
		console.log('Missing BASE_SHA or HEAD_SHA, skipping.');
		return;
	}

	const changedFiles = sh('git', ['diff', '--name-only', `${baseSha}...${headSha}`])
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	if (changedFiles.some((p) => p.startsWith('.changeset/') && p.endsWith('.md'))) {
		console.log('PR already contains a changeset file; nothing to do.');
		return;
	}

	const packageJsonPaths = changedFiles.filter((p) => p.endsWith('package.json'));
	if (packageJsonPaths.length === 0) {
		console.log('No package.json changes detected; nothing to do.');
		return;
	}

	const depKeys = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
	const packageBumps = new Map<string, BumpType>();
	const packageSummaries = new Map<
		string,
		Array<{ depName: string; from: unknown; to: unknown }>
	>();

	for (const pkgPath of packageJsonPaths) {
		if (!pkgPath.startsWith('packages/')) continue; // only published workspace packages

		const before = readJsonAt(baseSha, pkgPath);
		const after = await readJsonFile(pkgPath);

		if (!isRecord(before) || !isRecord(after)) continue;

		if (after.private === true) continue;
		const pkgName = getString(after.name);
		if (!pkgName) continue;

		let bump: BumpType = 'patch';
		const updates: Array<{ depName: string; from: unknown; to: unknown }> = [];
		const seenDeps = new Set<string>();

		for (const key of depKeys) {
			const prev = isRecord(before[key]) ? (before[key] as Record<string, unknown>) : {};
			const next = isRecord(after[key]) ? (after[key] as Record<string, unknown>) : {};

			for (const depName of Object.keys(next)) {
				if (seenDeps.has(depName)) continue;

				const from = prev[depName];
				const to = next[depName];
				if (from === undefined || to === undefined || from === to) continue;

				seenDeps.add(depName);
				bump = maxBump(bump, semverDiffType(from, to));
				updates.push({ depName, from, to });
			}
		}

		if (updates.length === 0) continue;

		packageBumps.set(pkgName, bump);
		packageSummaries.set(pkgName, updates);
	}

	if (packageBumps.size === 0) {
		console.log('No publishable dependency changes detected; nothing to do.');
		return;
	}

	await mkdir('.changeset', { recursive: true });

	const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
	const rand = Math.random().toString(16).slice(2, 10);
	const changesetPath = `.changeset/renovate-deps-${stamp}-${rand}.md`;

	const frontMatterLines: string[] = ['---'];
	for (const [pkgName, bump] of packageBumps.entries()) {
		frontMatterLines.push(`${JSON.stringify(pkgName)}: ${bump}`);
	}
	frontMatterLines.push('---');

	const summaryLines: string[] = [];
	for (const [pkgName, updates] of packageSummaries.entries()) {
		const deps = updates
			.slice(0, 6)
			.map((u) => `${u.depName} (${String(u.from)} → ${String(u.to)})`)
			.join(', ');
		summaryLines.push(`- ${pkgName}: ${deps}`);
	}

	const body = [
		...frontMatterLines,
		'',
		'chore(deps): update dependencies',
		'',
		...summaryLines,
		'',
	].join('\n');
	await writeFile(changesetPath, body, 'utf8');

	console.log(`Created ${changesetPath}`);
}

await main();
