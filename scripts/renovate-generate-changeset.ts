import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';

function sh(cmd: string, args: string[]): string {
	return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
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

	for (const pkgPath of packagesToScan) {
		const before = readJsonAt(baseSha, pkgPath);
		const after = await readJsonFile(pkgPath);
		if (!isRecord(before) || !isRecord(after) || after.private === true) continue;
		if (typeof after.name !== 'string') continue;

		for (const { name, from, to } of dependencyUpdates(
			before,
			after,
			rootPkgBefore,
			rootPkgAfter,
		)) {
			const id = createHash('sha256')
				.update(JSON.stringify([after.name, name, from, to]))
				.digest('hex')
				.slice(0, 16);
			const changesetPath = `.changeset/renovate-deps-${id}.md`;
			await mkdir('.changeset', { recursive: true });
			await writeFile(
				changesetPath,
				`---\n${JSON.stringify(after.name)}: minor\n---\n\nUpdate ${name} from ${from} to ${to}.\n`,
			);
			console.log(`Created ${changesetPath}`);
		}
	}
}

function dependencyUpdates(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	rootBefore: unknown,
	rootAfter: unknown,
): Array<{ name: string; from: string; to: string }> {
	const updates = new Map<string, { name: string; from: string; to: string }>();
	for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
		const prev = before[key];
		const next = after[key];
		if (!isRecord(prev) || !isRecord(next)) continue;
		for (const [name, rawTo] of Object.entries(next)) {
			const rawFrom = prev[name];
			if (typeof rawFrom !== 'string' || typeof rawTo !== 'string') continue;
			const from = resolveVersion(name, rawFrom, rootBefore);
			const to = resolveVersion(name, rawTo, rootAfter);
			if (from !== to) updates.set(name, { name, from, to });
		}
	}
	return [...updates.values()];
}

await main();
