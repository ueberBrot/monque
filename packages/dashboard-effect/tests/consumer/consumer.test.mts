import { createRequire } from "node:module";
import { NodeFileSystem } from "@effect/platform-node";
import { dashboardEffectLayer } from "@monque/dashboard-effect";
import { Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import { assert, expect, it, describe } from "vitest";

describe("isolated package consumption", () => {
  it("portable Dashboard exports, deep links and assets work in Node", async () => {
    const require = createRequire(import.meta.url);

    for (const name of ["express", "@effect/platform-bun"]) {
      expect(() => require.resolve(name)).toThrow(
        expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
      );
    }

    const callable: unknown = expect.any(Function);
    expect(require("@monque/dashboard-effect")).toMatchObject({ dashboardEffectLayer: callable });

    const app = HttpRouter.toWebHandler(
      dashboardEffectLayer({ basePath: "/ui", apiBaseUrl: "/ops" }).pipe(
        HttpRouter.provideRequest(
          Layer.mergeAll(
            NodeFileSystem.layer,
            Path.layer,
            HttpPlatform.layer.pipe(Layer.provide([NodeFileSystem.layer, Etag.layerWeak])),
          ),
        ),
      ),
      { disableLogger: true },
    );

    try {
      const response = await app.handler(new Request("http://localhost/ui/jobs/a.b"));
      assert.strictEqual(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('"apiBaseUrl":"/ops"'));
      const asset = /src="(?<asset>[^"]+\.js)"/u.exec(html)?.groups?.["asset"];
      assert.ok(asset !== undefined);
      const result = await app.handler(new Request(`http://localhost${asset}`));
      assert.strictEqual(result.status, 200);
      assert.notStrictEqual(await result.text(), "");
    } finally {
      await app.dispose();
    }

    console.log(
      "Isolated Node consumer: built ESM/CJS exports, HTML/assets, no Express/Bun passed",
    );
  }, 120_000);
});
