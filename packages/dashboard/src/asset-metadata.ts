import path from "node:path";

const DASHBOARD_RUNTIME_CONFIG_GLOBAL = "__MONQUE_DASHBOARD_CONFIG__";
const DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID = "monque-dashboard-runtime-config";
// oxlint-disable-next-line typescript/consistent-type-definitions -- The published alias is assignable to string-indexed records; an interface changes that consumer contract.
type DashboardAssetMetadata = {
  assetDirectory: "client";
  htmlEntrypoint: "index.html";
  manifestPath: ".vite/manifest.json";
  runtimeConfigGlobal: typeof DASHBOARD_RUNTIME_CONFIG_GLOBAL;
  runtimeConfigScriptId: typeof DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID;
};
const dashboardAssetMetadata: DashboardAssetMetadata = {
  assetDirectory: "client",
  htmlEntrypoint: "index.html",
  manifestPath: ".vite/manifest.json",
  runtimeConfigGlobal: DASHBOARD_RUNTIME_CONFIG_GLOBAL,
  runtimeConfigScriptId: DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID,
};
const dashboardPackageDistDirectory = import.meta.dirname;
const getDashboardAssetMetadata = (): DashboardAssetMetadata => dashboardAssetMetadata;
const getDashboardAssetDirectory = (): string =>
  path.join(dashboardPackageDistDirectory, dashboardAssetMetadata.assetDirectory);
const getDashboardHtmlEntrypointPath = (): string =>
  path.join(getDashboardAssetDirectory(), dashboardAssetMetadata.htmlEntrypoint);
const getDashboardManifestPath = (): string =>
  path.join(getDashboardAssetDirectory(), dashboardAssetMetadata.manifestPath);
export {
  DASHBOARD_RUNTIME_CONFIG_GLOBAL,
  DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID,
  type DashboardAssetMetadata,
  getDashboardAssetDirectory,
  getDashboardAssetMetadata,
  getDashboardHtmlEntrypointPath,
  getDashboardManifestPath,
};
