import { Configuration, Inject } from '@tsed/di';
import type { PlatformApplication } from '@tsed/platform-http';
import '@tsed/platform-http';

/**
 * Minimal Ts.ED server for integration tests.
 * Configured via PlatformTest.bootstrap() in tests.
 */
@Configuration({
	// Configuration is provided by tests
})
export class Server {
	@Inject()
	app?: PlatformApplication;

	@Configuration()
	settings?: Configuration;
}
