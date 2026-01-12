import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface CoverageMetric {
	pct?: number;
	covered?: number;
	total?: number;
}

interface CoverageSummaryTotal {
	lines?: CoverageMetric;
	statements?: CoverageMetric;
	functions?: CoverageMetric;
	branches?: CoverageMetric;
}

interface CoverageSummaryJson {
	total?: CoverageSummaryTotal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isCoverageMetric(value: unknown): value is CoverageMetric {
	if (!isRecord(value)) return false;

	if ('pct' in value && value.pct !== undefined && typeof value.pct !== 'number') return false;
	if ('covered' in value && value.covered !== undefined && typeof value.covered !== 'number') {
		return false;
	}
	if ('total' in value && value.total !== undefined && typeof value.total !== 'number')
		return false;

	return true;
}

function isCoverageSummaryTotal(value: unknown): value is CoverageSummaryTotal {
	if (!isRecord(value)) return false;

	for (const key of ['lines', 'statements', 'functions', 'branches'] as const) {
		if (!(key in value)) continue;
		if (value[key] !== undefined && !isCoverageMetric(value[key])) return false;
	}

	return true;
}

function isCoverageSummaryJson(value: unknown): value is CoverageSummaryJson {
	if (!isRecord(value)) return false;
	if (!('total' in value)) return false;
	if (value.total !== undefined && !isCoverageSummaryTotal(value.total)) return false;
	return true;
}

/**
 * Path to the `coverage-summary.json` file.
 *
 * Defaults to the core package coverage output location. When executed via Turbo,
 * Vitest runs with the package working directory, so core coverage ends up under
 * `packages/core/coverage/`.
 */
const coverageSummaryPath = process.argv[2] ?? 'packages/core/coverage/coverage-summary.json';

/**
 * GitHub Actions provides a file path in `GITHUB_STEP_SUMMARY`.
 * Writing markdown into that file will render it in the job UI.
 */
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const outputPath = stepSummaryPath && stepSummaryPath.trim().length > 0 ? stepSummaryPath : null;

function append(markdown: string): void {
	if (outputPath) {
		appendFileSync(outputPath, markdown);
		return;
	}

	process.stdout.write(markdown);
}

if (!existsSync(coverageSummaryPath)) {
	append(
		[
			'## Coverage',
			'',
			`Coverage summary not found at \`${coverageSummaryPath}\`.`,
			'',
			'This can happen if tests fail before coverage is produced, or if coverage is disabled for this run.',
			'',
		].join('\n'),
	);
	process.exit(0);
}

const raw = readFileSync(coverageSummaryPath, 'utf8');
let parsed: unknown;

try {
	parsed = JSON.parse(raw);
} catch {
	append(['## Coverage', '', `Invalid JSON in \`${coverageSummaryPath}\`.`, ''].join('\n'));
	process.exit(0);
}

if (!isCoverageSummaryJson(parsed) || !parsed.total) {
	append(
		[
			'## Coverage',
			'',
			`Invalid coverage summary format in \`${coverageSummaryPath}\` (missing 'total').`,
			'',
		].join('\n'),
	);
	process.exit(0);
}

const total = parsed.total;

function formatPct(entry: CoverageMetric | undefined): string {
	const pct = entry?.pct;
	return typeof pct === 'number' ? pct.toFixed(2) : 'n/a';
}

function formatCoveredTotal(entry: CoverageMetric | undefined): string {
	const covered = entry?.covered;
	const tot = entry?.total;
	if (typeof covered !== 'number' || typeof tot !== 'number') return 'n/a';
	return `${covered}/${tot}`;
}

const relPath = path.relative(process.cwd(), coverageSummaryPath);

append(
	[
		'## Coverage',
		'',
		`Source: \`${relPath}\``,
		'',
		'| Metric | % | Covered / Total |',
		'|---|---:|---:|',
		`| Statements | ${formatPct(total.statements)} | ${formatCoveredTotal(total.statements)} |`,
		`| Branches | ${formatPct(total.branches)} | ${formatCoveredTotal(total.branches)} |`,
		`| Functions | ${formatPct(total.functions)} | ${formatCoveredTotal(total.functions)} |`,
		`| Lines | ${formatPct(total.lines)} | ${formatCoveredTotal(total.lines)} |`,
		'',
	].join('\n'),
);
