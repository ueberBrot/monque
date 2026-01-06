// @ts-check

import { readFileSync } from 'node:fs';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightThemeNova from 'starlight-theme-nova';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

import remarkMermaidToPre from './src/remark/remark-mermaid-to-pre.mjs';

const corePackageJsonUrl = new URL('../core/package.json', import.meta.url);
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
		remarkPlugins: [remarkMermaidToPre],
	},
	site: 'https://ueberBrot.github.io',
	base: '/monque',
	integrations: [
		starlight({
			title: 'Monque',
			description:
				'A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.',
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
			},
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ueberbrot/monque' }],
			editLink: {
				baseUrl: 'https://github.com/ueberbrot/monque/edit/main/packages/docs/',
			},
			lastUpdated: true,
			customCss: ['./src/styles/custom.css'],
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
					],
				},
				{
					label: 'Advanced',
					items: [
						{ label: 'Atomic Claim Pattern', slug: 'advanced/atomic-claim' },
						{ label: 'Change Streams', slug: 'advanced/change-streams' },
						{ label: 'Heartbeat Mechanism', slug: 'advanced/heartbeat' },
					],
				},
				typeDocSidebarGroup,
			],
			head: [
				{
					tag: 'meta',
					attrs: {
						property: 'og:image',
						content: 'https://ueberBrot.github.io/monque/favicon.svg',
					},
				},
				{
					tag: 'script',
					attrs: { type: 'module' },
					content: `
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

mermaid.initialize({ startOnLoad: false });

async function renderMermaid() {
  try {
    await mermaid.run({ querySelector: 'pre.mermaid' });
  } catch {
    // ignore render errors
  }
}

window.addEventListener('DOMContentLoaded', renderMermaid);
document.addEventListener('astro:page-load', renderMermaid);
document.addEventListener('astro:after-swap', renderMermaid);
`,
				},
			],
			plugins: [
				starlightLlmsTxt(),
				starlightThemeNova(),
				starlightLinksValidator({
					errorOnRelativeLinks: true,
				}),
				starlightTypeDoc({
					entryPoints: ['../core/src/index.ts'],
					tsconfig: '../core/tsconfig.json',
					output: 'api',
					sidebar: {
						label: 'API Reference',
						collapsed: false,
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
