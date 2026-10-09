import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import * as contractExports from "@/contract.js";

const EXPECTED_CONTRACT_SUBPATH_EXPORT = {
  import: {
    types: "./dist/contract.d.mts",
    default: "./dist/contract.mjs",
  },
  require: {
    types: "./dist/contract.d.cts",
    default: "./dist/contract.cjs",
  },
} as const;

const EXPECTED_CONTRACT_PACKAGE_JSON = {
  type: "module",
  main: "../dist/contract.cjs",
  module: "../dist/contract.mjs",
  types: "../dist/contract.d.mts",
} as const;

const BROWSER_SAFE_RUNTIME_EXPORTS = [
  "SelectedJobActionsDtoSchema",
  "SetJobPriorityInputDtoSchema",
  "SetJobPriorityRequestDtoSchema",
  "managementContract",
  "JobDtoSchema",
  "JobListQueryDtoSchema",
  "JobStatsQueryDtoSchema",
  "QueueViewSummaryListDtoSchema",
  "SchedulerHealthDtoSchema",
] as const;

const SERVER_ONLY_RUNTIME_EXPORTS = [
  "createManagementSurface",
  "createManagementRouter",
  "generateManagementOpenApiDocument",
] as const;

const packageJson: unknown = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

const contractPackageJson: unknown = JSON.parse(
  readFileSync(new URL("../../contract/package.json", import.meta.url), "utf-8"),
);

describe("management contract subpath export", () => {
  it("publishes a browser-safe ./contract subpath with ESM, CJS, and types entrypoints", () => {
    expect(packageJson).toMatchObject({
      exports: { "./contract": EXPECTED_CONTRACT_SUBPATH_EXPORT },
    });
    expect(contractPackageJson).toStrictEqual(EXPECTED_CONTRACT_PACKAGE_JSON);
  });

  it("exports the runtime contract and DTO schemas without server-only factories", () => {
    for (const exportName of BROWSER_SAFE_RUNTIME_EXPORTS) {
      expect(contractExports).toHaveProperty(exportName);
    }

    for (const exportName of SERVER_ONLY_RUNTIME_EXPORTS) {
      expect(contractExports).not.toHaveProperty(exportName);
    }
  });
});
