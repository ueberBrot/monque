declare const __MONQUE_CORE_VERSION__: string;

// Starlight 0.42 ships compiled types without its virtual config declaration.
declare module 'virtual:starlight/user-config' {
	const config: import('@astrojs/starlight/types').StarlightConfig;
	export default config;
}

declare module 'virtual:starlight/user-images' {
	type ImageMetadata = import('astro').ImageMetadata;

	export const logos: {
		dark?: ImageMetadata;
		light?: ImageMetadata;
	};
}
