import fs from 'node:fs';
import path from 'node:path';

/**
 * GitHub Actions Job Summary helper.
 *
 * This script reads an Istanbul-style JSON coverage summary (as produced by Vitest's
 * `json-summary` coverage reporter) and appends a small markdown table to the GitHub
 * Actions step summary.
 *
 * - In GitHub Actions: writes to `process.env.GITHUB_STEP_SUMMARY` (a file path).
 * - Locally: falls back to stdout.
 *
 * Usage:
 *   bun scripts/coverage-summary.mjs packages/core/coverage/coverage-summary.json
 *
 * Expected input structure (subset):
 * {
 *   "total": {
 *     "lines": { "pct": number, "covered": number, "total": number },
 *     "statements": { "pct": number, "covered": number, "total": number },
 *     "functions": { "pct": number, "covered": number, "total": number },
 *     "branches": { "pct": number, "covered": number, "total": number }
 *   }
 * }
 */

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

/**
 * Append markdown either to the GitHub Actions step summary file or stdout.
 *
 * @param {string} markdown - Markdown content to append.
 */
const append = (markdown) => {
	if (outputPath) {
		fs.appendFileSync(outputPath, markdown);
		return;
	}

	process.stdout.write(markdown);
};

// If coverage isn't present (e.g., tests failed early or coverage was disabled),
// we keep CI green and add a short note to the summary instead of erroring.
if (!fs.existsSync(coverageSummaryPath)) {
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

// Parse the coverage summary JSON.
const raw = fs.readFileSync(coverageSummaryPath, 'utf8');
const data = JSON.parse(raw);

// Vitest's `json-summary` reporter puts totals under `data.total`.
const total = data?.total;
if (!total) {
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

/**
 * Format percentage values to 2 decimal places.
 *
 * @param {{ pct?: number } | undefined} entry
 * @returns {string}
 */
const formatPct = (entry) => {
	const pct = entry?.pct;
	return typeof pct === 'number' ? pct.toFixed(2) : 'n/a';
};

/**
 * Format a `covered/total` string.
 *
 * @param {{ covered?: number, total?: number } | undefined} entry
 * @returns {string}
 */
const formatCoveredTotal = (entry) => {
	const covered = entry?.covered;
	const tot = entry?.total;
	if (typeof covered !== 'number' || typeof tot !== 'number') return 'n/a';
	return `${covered}/${tot}`;
};

// Use a stable, readable path in the summary (especially helpful in CI logs).
const relPath = path.relative(process.cwd(), coverageSummaryPath);

// Render a compact markdown table in the job summary.
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
