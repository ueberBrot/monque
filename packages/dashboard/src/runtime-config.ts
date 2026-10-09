import { z } from "zod";

const isApiBaseUrl = (value: string): boolean => {
  if (!value.trim() || value !== value.trim() || /[\\\r\n\t]/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value, "https://dashboard.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
const isMountPath = (value: string): boolean =>
  value.trim().length > 0 &&
  value === value.trim() &&
  !value.startsWith("//") &&
  !/[?#\\\r\n\t]/u.test(value) &&
  !value.includes("://") &&
  !value.split("/").some((segment) => /^(?:\.|%2e){1,2}$/iu.test(segment));
const DashboardRuntimeConfigSchema = z.strictObject({
  apiBaseUrl: z.string().refine(isApiBaseUrl, {
    message: "apiBaseUrl must be an HTTP(S) URL or a relative API path.",
  }),
  basePath: z.string().refine(isMountPath, {
    message: "basePath must be a mount path without a query, fragment, or dot segments.",
  }),
  pollingIntervalMs: z.number().int().positive().optional(),
});
type DashboardRuntimeConfig = z.infer<typeof DashboardRuntimeConfigSchema>;
declare global {
  interface Window {
    __MONQUE_DASHBOARD_CONFIG__?: unknown;
  }
}
const normalizeBasePath = (basePath: string): string => {
  if (basePath === "/") {
    return "/";
  }
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
};
const NormalizedDashboardRuntimeConfigSchema = DashboardRuntimeConfigSchema.transform(
  (parsed): DashboardRuntimeConfig => ({
    ...parsed,
    basePath: normalizeBasePath(parsed.basePath),
  }),
);
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This published parser accepts arbitrary host input; Zod validates it before returning the public configuration type.
const parseDashboardRuntimeConfig = (config: unknown): DashboardRuntimeConfig =>
  NormalizedDashboardRuntimeConfigSchema.parse(config);

export { type DashboardRuntimeConfig, DashboardRuntimeConfigSchema, parseDashboardRuntimeConfig };
