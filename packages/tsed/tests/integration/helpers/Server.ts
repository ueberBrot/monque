import { Configuration } from '@tsed/di';

@Configuration({
	port: 0,
	disableComponentScan: true,
	httpsPort: false,
})
export class Server {}
