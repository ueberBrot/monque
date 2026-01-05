// @ts-check

import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightThemeNova from 'starlight-theme-nova';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// https://astro.build/config
export default defineConfig({
	site: 'https://monque.dev',
	integrations: [
		starlight({
			title: 'Monque',
			description:
				'A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.',
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ueberBrot/monque' }],
			editLink: {
				baseUrl: 'https://github.com/ueberBrot/monque/edit/main/packages/docs/',
			},
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
						content: 'https://monque.dev/og-image.png',
					},
				},
			],
			plugins: [
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
					},
				}),
			],
		}),
	],
});
