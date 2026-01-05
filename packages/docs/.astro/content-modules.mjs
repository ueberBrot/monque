export default new Map([
	[
		'src/content/docs/index.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Findex.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/advanced/atomic-claim.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fadvanced%2Fatomic-claim.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/advanced/change-streams.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fadvanced%2Fchange-streams.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/advanced/heartbeat.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fadvanced%2Fheartbeat.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/getting-started/installation.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fgetting-started%2Finstallation.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/getting-started/quick-start.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fgetting-started%2Fquick-start.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/core-concepts/jobs.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fcore-concepts%2Fjobs.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/core-concepts/retry.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fcore-concepts%2Fretry.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/core-concepts/scheduling.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fcore-concepts%2Fscheduling.mdx&astroContentModuleFlag=true'
			),
	],
	[
		'src/content/docs/core-concepts/workers.mdx',
		() =>
			import(
				'astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fcore-concepts%2Fworkers.mdx&astroContentModuleFlag=true'
			),
	],
]);
