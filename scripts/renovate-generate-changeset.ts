import { execFileSync } from 'node:child_process';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';

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

interface PackageJson {
	name?: string;
	private?: boolean;
	workspaces?: {
		catalog?: Record<string, string>;
		catalogs?: Record<string, Record<string, string>>;
	};
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	[key: string]: unknown;
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

function resolveVersion(depName: string, version: string, rootPkg: unknown): string {
	const pkg = rootPkg as PackageJson | null;
	if (version === 'catalog:') {
		return pkg?.workspaces?.catalog?.[depName] ?? version;
	}
	if (version.startsWith('catalog:')) {
		const catalogName = version.split(':')[1];
		return pkg?.workspaces?.catalogs?.[catalogName]?.[depName] ?? version;
	}
	return version;
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

	const rootPkgBefore = readJsonAt(baseSha, 'package.json');
	const rootPkgAfter = await readJsonFile('package.json');

	const packageJsonPaths = changedFiles.filter((p) => p.endsWith('package.json'));
	const isRootChanged = packageJsonPaths.includes('package.json');

	// If root changed, we must check all packages in packages/*
	const packagesToScan = new Set<string>(packageJsonPaths.filter((p) => p.startsWith('packages/')));
	if (isRootChanged) {
		for await (const p of glob('packages/*/package.json')) {
			if (p) packagesToScan.add(p);
		}
	}

	if (packagesToScan.size === 0) {
		console.log('No relevant package changes detected; nothing to do.');
		return;
	}

	const depKeys = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
	const packageBumps = new Map<string, BumpType>();
	const packageSummaries = new Map<string, Array<{ depName: string; from: string; to: string }>>();

	for (const pkgPath of packagesToScan) {
		const before = readJsonAt(baseSha, pkgPath);
		const after = await readJsonFile(pkgPath);

		if (!isRecord(before) || !isRecord(after)) continue;
		if (after.private === true) continue;

		const pkgName = after.name;
		if (typeof pkgName !== 'string') continue;

		let bump: BumpType = 'patch';
		const updatesMap = new Map<string, { from: string; to: string; type: BumpType }>();

		for (const key of depKeys) {
			const prev = isRecord(before[key]) ? (before[key] as Record<string, string>) : {};
			const next = isRecord(after[key]) ? (after[key] as Record<string, string>) : {};

			const allDepNames = new Set([...Object.keys(prev), ...Object.keys(next)]);

			for (const depName of allDepNames) {
				const rawFrom = prev[depName];
				const rawTo = next[depName];

				if (rawFrom === undefined || rawTo === undefined) continue;

				const from = resolveVersion(depName, rawFrom, rootPkgBefore);
				const to = resolveVersion(depName, rawTo, rootPkgAfter);

				if (from === to) continue;

				const type = semverDiffType(from, to);
				bump = maxBump(bump, type);

				const existing = updatesMap.get(depName);
				const order: Record<BumpType, number> = { patch: 0, minor: 1, major: 2 };

				if (!existing || order[type] > order[existing.type]) {
					updatesMap.set(depName, { from, to, type });
				}
			}
		}

		const updates = Array.from(updatesMap.entries()).map(([depName, data]) => ({
			depName,
			from: data.from,
			to: data.to,
		}));

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
		for (const u of updates) {
			summaryLines.push(`- ${pkgName}: ${u.depName} (${u.from} → ${u.to})`);
		}
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
