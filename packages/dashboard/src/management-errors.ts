import { z } from "zod";

// oxlint-disable promise/prefer-await-to-then -- Zod.catch defines a synchronous parse fallback, not a Promise handler.
const ErrorMessageSchema = z.string().min(1).optional().catch(undefined);
const ManagementErrorSchema = z.object({
  status: z.number().int().optional().catch(undefined),
  message: ErrorMessageSchema,
  data: z
    .object({
      error: ErrorMessageSchema,
      body: z.object({ error: ErrorMessageSchema }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});
const ReadManagementErrorSchema = ManagementErrorSchema.transform(({ status, message, data }) => ({
  status,
  message: data?.error ?? data?.body?.error ?? message,
})).catch(() => ({ status: undefined, message: undefined }));
const readManagementError = ReadManagementErrorSchema.parse.bind(ReadManagementErrorSchema);

// oxlint-enable promise/prefer-await-to-then
type DashboardErrorCode = "unauthorized" | "forbidden" | "not-found" | "error";
type DashboardErrorResource = "health" | "jobs" | "job" | "queue-views";
interface ErrorPresentation {
  readonly title: string;
  readonly description: string;
  readonly tone: "default" | "danger" | "warning";
}
/** Keep read-error classification and recovery copy together. */
const resolveDashboardApiErrorState = (
  error: Parameters<typeof readManagementError>[0],
  resource: DashboardErrorResource = "health",
  failureTitle?: string,
): ErrorPresentation & {
  readonly code: DashboardErrorCode;
} => {
  const { status, message } = readManagementError(error);
  if (status === 401) {
    return {
      code: "unauthorized",
      title:
        resource === "job" || resource === "jobs" ? "Sign in required" : "Authentication required",
      description: message ?? "Sign in through the host application, then retry.",
      tone: "warning",
    };
  }
  if (status === 403) {
    return {
      code: "forbidden",
      title: resource === "job" ? "Job detail is forbidden" : "Access denied",
      description: message ?? "Your current session cannot view this Management surface.",
      tone: resource === "jobs" ? "warning" : "danger",
    };
  }
  if (status === 404 && resource === "job") {
    return {
      code: "not-found",
      title: "Job not found",
      description: message ?? "The Job may have been deleted or the copied URL is stale.",
      tone: "default",
    };
  }
  const titles = {
    health: "Dashboard data unavailable",
    jobs: "Jobs failed to load",
    job: "Job detail could not be loaded",
    "queue-views": "Queue Views failed to load",
  };
  return {
    code: "error",
    title: failureTitle ?? titles[resource],
    description:
      message ?? "Dashboard data could not be loaded. Check your connection, then retry.",
    tone: "danger",
  };
};
export { readManagementError, resolveDashboardApiErrorState };
