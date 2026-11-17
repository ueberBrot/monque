import {
  DASHBOARD_RUNTIME_CONFIG_GLOBAL,
  DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID,
} from "./asset-metadata.js";
import type { DashboardRuntimeConfig } from "./runtime-config.js";

export const shouldServeDashboardHtml = function shouldServeDashboardHtml(
  pathname: string,
): boolean {
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/assets" ||
    pathname.startsWith("/assets/")
  ) {
    return false;
  }

  if (
    pathname === "/index.html" ||
    pathname.startsWith("/queue-views/") ||
    pathname.startsWith("/jobs/")
  ) {
    return true;
  }

  return !pathname.includes(".");
};

const escapeRegularExpression = function escapeRegularExpression(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};

export const renderDashboardHtml = function renderDashboardHtml(
  htmlTemplate: string,
  runtimeConfig: DashboardRuntimeConfig,
): string {
  const assetBasePath = `${runtimeConfig.basePath.replace(/\/$/u, "")}/assets/`
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  // Relative Vite assets otherwise resolve below a deep-link route (for example /jobs/:id).
  const mountAwareHtml = htmlTemplate.replaceAll(
    /\b(?<attribute>src|href)=(?<quote>['"])\.\/assets\//gu,
    (_match, attribute: string, quote: string) => `${attribute}=${quote}${assetBasePath}`,
  );

  const runtimeConfigJson = JSON.stringify(runtimeConfig).replaceAll("<", "\\u003c");

  const runtimeConfigScript = [
    `<script id="${DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID}">`,
    `window.${DASHBOARD_RUNTIME_CONFIG_GLOBAL} = ${runtimeConfigJson};`,
    "</script>",
  ].join("");

  return mountAwareHtml.replace(
    new RegExp(
      `<script\\s+id=["']${escapeRegularExpression(DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID)}["'][^>]*>[\\s\\S]*?<\\/script>`,
      "u",
    ),
    () => runtimeConfigScript,
  );
};
