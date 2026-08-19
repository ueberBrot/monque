/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command: readonly [string, ...string[]]): void {
	const [executable, ...args] = command;
	const result = spawnSync(executable, args, {
		cwd: process.cwd(),
		stdio: 'inherit',
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`${command.join(' ')} exited with code ${result.status ?? 'unknown'}`);
	}
}

async function main(): Promise<void> {
	run(['bun', 'x', 'publint']);

	const directory = await mkdtemp(join(tmpdir(), 'monque-exports-'));
	const archive = join(directory, 'package.tgz');

	try {
		run(['bun', 'pm', 'pack', '--filename', archive, '--quiet']);
		run(['bun', 'x', 'attw', archive]);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

main().catch((error: unknown): void => {
	console.error(error instanceof Error ? error : new Error(String(error)));
	process.exitCode = 1;
});
