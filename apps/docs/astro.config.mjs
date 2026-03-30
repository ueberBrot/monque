// @ts-check

import { readFileSync } from 'node:fs';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import astroMermaid from 'astro-mermaid';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightThemeNova from 'starlight-theme-nova';
import starlightTypeDoc from 'starlight-typedoc';

const corePackageJsonUrl = new URL('../../packages/core/package.json', import.meta.url);
const corePackageJson = JSON.parse(readFileSync(corePackageJsonUrl, 'utf8'));
const coreVersion =
	typeof corePackageJson?.version === 'string' ? corePackageJson.version : 'unknown';

// https://astro.build/config
export default defineConfig({
	vite: {
		define: {
			__MONQUE_CORE_VERSION__: JSON.stringify(coreVersion),
		},
	},
	markdown: {
		remarkPlugins: [],
	},
	site: 'https://ueberBrot.github.io',
	base: '/monque',
	integrations: [
		astroMermaid(),
		starlight({
			title: 'Monque',
			description:
				'A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.',
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
			},
			logo: {
				src: './src/assets/icon.svg',
				replacesTitle: false,
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ueberbrot/monque' }],
			editLink: {
				baseUrl: 'https://github.com/ueberbrot/monque/edit/main/apps/docs/',
			},
			lastUpdated: true,
			customCss: [
				'@fontsource/quicksand/400.css',
				'@fontsource/quicksand/500.css',
				'@fontsource/quicksand/600.css',
				'@fontsource/quicksand/700.css',
				'./src/styles/custom.css',
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start', slug: 'getting-started/quick-start' },
					],
				},
				{
					label: 'Core Concepts',
					items: [
						{ label: 'Jobs', slug: 'core-concepts/jobs' },
						{ label: 'Workers', slug: 'core-concepts/workers' },
						{ label: 'Scheduling', slug: 'core-concepts/scheduling' },
						{ label: 'Retry & Backoff', slug: 'core-concepts/retry' },
						{ label: 'Job Management', slug: 'core-concepts/management' },
					],
				},
				{
					label: 'Advanced',
					items: [
						{ label: 'Atomic Claim Pattern', slug: 'advanced/atomic-claim' },
						{ label: 'Change Streams', slug: 'advanced/change-streams' },
						{ label: 'Heartbeat Mechanism', slug: 'advanced/heartbeat' },
						{ label: 'Production Checklist', slug: 'advanced/production-checklist' },
					],
				},
				{
					label: 'Integrations',
					items: [{ label: 'Ts.ED', slug: 'integrations/tsed' }],
				},
				{
					label: 'Roadmap',
					slug: 'roadmap',
				},
				{
					label: 'API Reference',
					items: [
						{
							label: 'Core API',
							autogenerate: { directory: 'api' },
							collapsed: true,
						},
						{
							label: 'Ts.ED API',
							autogenerate: { directory: 'api-tsed' },
							collapsed: true,
						},
					],
				},
			],
			head: [
				{
					tag: 'meta',
					attrs: {
						property: 'og:image',
						content: 'https://ueberBrot.github.io/monque/favicon.svg',
					},
				},
			],
			plugins: [
				starlightLlmsTxt(),
				starlightThemeNova(),
				starlightLinksValidator({
					errorOnRelativeLinks: true,
				}),
				starlightTypeDoc({
					entryPoints: ['../../packages/core/src/index.ts'],
					tsconfig: '../../packages/core/tsconfig.json',
					output: 'api',
					sidebar: {
						label: 'Core API',
						collapsed: true,
					},
					typeDoc: {
						excludePrivate: true,
						excludeProtected: true,
						excludeInternal: true,
						readme: 'none',
						parametersFormat: 'table',
						enumMembersFormat: 'table',
						useCodeBlocks: true,
						gitRevision: 'main',
					},
				}),
				starlightTypeDoc({
					entryPoints: ['../../packages/tsed/src/index.ts'],
					tsconfig: '../../packages/tsed/tsconfig.json',
					output: 'api-tsed',
					sidebar: {
						label: 'Ts.ED API',
						collapsed: true,
					},
					typeDoc: {
						excludePrivate: true,
						excludeProtected: true,
						excludeInternal: true,
						readme: 'none',
						parametersFormat: 'table',
						enumMembersFormat: 'table',
						useCodeBlocks: true,
						gitRevision: 'main',
					},
				}),
			],
		}),
	],
});
