import { PlatformTest } from '@tsed/platform-http/testing';

export function bootstrap(module: any) {
	return PlatformTest.bootstrap(module, {
		disableComponentScan: true,
		logger: {
			level: 'off',
		},
	});
}
