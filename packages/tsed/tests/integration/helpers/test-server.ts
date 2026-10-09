import { Configuration } from "@tsed/di";

@Configuration({
  port: 0,
  disableComponentScan: true,
  httpsPort: false,
})
// oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
export class Server {}
