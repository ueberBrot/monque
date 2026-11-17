import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { packRelease } from "../../../scripts/verification/pack-release.mts";

// oxlint-disable-next-line typescript/strict-void-return -- Node promisify accepts the value-returning execFile callback API.
const exec = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "dashboard-effect-consumer-"));
const root = path.resolve(import.meta.dirname, "../../..");

try {
  const archives = await packRelease(root, ["dashboard", "dashboard-effect"], directory);
  const dashboard = archives["@monque/dashboard"];
  const adapter = archives["@monque/dashboard-effect"];
  assert.ok(dashboard !== undefined && adapter !== undefined);
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      overrides: { "@monque/dashboard": `file:${dashboard}` },
      dependencies: {
        "@monque/dashboard": `file:${dashboard}`,
        "@monque/dashboard-effect": `file:${adapter}`,
        effect: "4.1.4",
        "@effect/platform-node": "4.1.4",
      },
    }),
  );
  await writeFile(
    path.join(directory, "consumer.mjs"),
    `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dashboardEffectLayer } from "@monque/dashboard-effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
const require = createRequire(import.meta.url);
for (const name of ["express", "@effect/platform-bun"]) {
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
}
assert.equal(typeof require("@monque/dashboard-effect").dashboardEffectLayer, "function");
const app = HttpRouter.toWebHandler(dashboardEffectLayer({ basePath: "/ui", apiBaseUrl: "/ops" }).pipe(
  HttpRouter.provideRequest(Layer.mergeAll(NodeFileSystem.layer, Path.layer,
    HttpPlatform.layer.pipe(Layer.provide([NodeFileSystem.layer, Etag.layerWeak]))))), { disableLogger: true });
try {
  const response = await app.handler(new Request("http://localhost/ui/jobs/a.b"));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('"apiBaseUrl":"/ops"'));
  const asset = /src="([^"]+\\.js)"/u.exec(html)[1];
  const result = await app.handler(new Request("http://localhost" + asset));
  assert.equal(result.status, 200);
  assert.ok((await result.text()).length > 100);
} finally { await app.dispose(); }
console.log("Isolated Node consumer: built ESM/CJS exports, HTML/assets, no Express/Bun passed");
`,
  );
  await exec("bun", ["install", "--ignore-scripts"], { cwd: directory });
  const result = await exec("node", ["consumer.mjs"], { cwd: directory });
  process.stdout.write(result.stdout);
} finally {
  await rm(directory, { recursive: true, force: true });
}
