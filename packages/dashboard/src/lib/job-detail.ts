import type { JobDto } from "@monque/management/contract";

import { isString, isObject } from "@/lib/type-guards";
/** Manual retry and successful recurring runs reset the failure counter. */
const getJobAttemptCount = (job: Pick<JobDto, "failCount" | "status">): number => {
  const hasCurrentOrSuccessfulAttempt = job.status === "processing" || job.status === "completed";
  return job.failCount + (hasCurrentOrSuccessfulAttempt ? 1 : 0);
};
const isStructuredPayload = (payload: JobDto["payload"]): payload is object =>
  isObject(payload) && payload !== null;
const isEmptyPayload = (payload: JobDto["payload"]): boolean => {
  if (payload === null || payload === "") {
    return true;
  }
  if (Array.isArray(payload)) {
    return payload.length === 0;
  }
  if (isStructuredPayload(payload)) {
    return Object.keys(payload).length === 0;
  }
  return false;
};
const serializePayloadForClipboard = (payload: JobDto["payload"]): string => {
  const serializedPayload = JSON.stringify(payload, null, 2);
  return serializedPayload ?? "null";
};
const formatPayloadForDisplay = (payload: JobDto["payload"]): string => {
  if (isString(payload)) {
    return payload;
  }
  return serializePayloadForClipboard(payload);
};
const getJobRunLabel = (job: Pick<JobDto, "status">): string =>
  job.status === "pending" ? "Next run" : "Scheduled for";
export {
  formatPayloadForDisplay,
  getJobAttemptCount,
  getJobRunLabel,
  isEmptyPayload,
  isStructuredPayload,
  serializePayloadForClipboard,
};
