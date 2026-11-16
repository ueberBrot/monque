import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { host } from "../src/host.js";
import { configuration } from "../src/options.js";

const options = {
  mongoUri: "invalid:must-not-connect",
  databaseName: "unused",
  operatorPassword: "secret",
  viewerPassword: "secret",
  managementPath: "/custom/control",
  dashboardPath: "/custom/ui",
  port: 0,
};

describe("host configuration", () => {
  it.each([
    { operatorPassword: "", message: /operatorPassword/u },
    { dashboardPath: "/custom/control/ui", message: /overlap/u },
    { dashboardPath: "/custom/ui/", message: /dashboardPath/u },
    { managementPath: "relative", message: /managementPath/u },
    { port: Number.NaN, message: /port/u },
  ])(
    "rejects invalid configuration before acquiring MongoDB (%j)",
    async ({ message, ...invalid }) => {
      await expect(
        Effect.runPromise(Effect.scoped(host({ ...options, ...invalid }))),
      ).rejects.toThrow(message);
    },
  );

  it("loads typed defaults from the application's configuration provider", async () => {
    const configured = await Effect.runPromise(
      configuration.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ OPERATOR_PASSWORD: "operator", VIEWER_PASSWORD: "viewer" }),
        ),
      ),
    );

    expect(configured).toMatchObject({
      port: 3000,
      dashboardPath: "/ops/dashboard",
      readOnly: false,
      tracing: false,
    });
  });
});
