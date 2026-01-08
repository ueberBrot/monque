import { defineConfig } from 'repomix';

export default defineConfig({
	input: {
		// Repomix default: 50MB
		maxFileSize: 50 * 1024 * 1024,
	},
	output: {
		filePath: 'repomix-core.md',
		style: 'markdown',
	},
	include: ['packages/core/**'],
	ignore: {
		useGitignore: true,
		useDotIgnore: true,
		useDefaultPatterns: true,
		customPatterns: [],
	},
	security: {
		enableSecurityCheck: true,
	},
	tokenCount: {
		encoding: 'o200k_base',
	},
});
