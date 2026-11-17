import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import {
  BulkActionResultDtoSchema,
  CapabilitiesDtoSchema,
  DeleteJobDtoSchema,
  JobCursorPageDtoSchema,
  JobDetailInputDtoSchema,
  JobDtoSchema,
  JobListQueryDtoSchema,
  JobSelectorDtoSchema,
  JobStatsQueryDtoSchema,
  ManagementErrorDtoSchema,
  ProcessingActionDtoSchema,
  ProcessingQueryDtoSchema,
  ProcessingStateDtoSchema,
  QueueStatsDtoSchema,
  QueueViewQueryDtoSchema,
  QueueViewSummaryListDtoSchema,
  RescheduleJobInputDtoSchema,
  SetJobPriorityInputDtoSchema,
  SchedulerHealthDtoSchema,
  SelectedJobActionsDtoSchema,
} from "../schemas/index.js";

const successDescription = "Successful response";

const ManagementMutationErrors = {
  BAD_REQUEST: {
    status: 400,
    data: ManagementErrorDtoSchema,
  },
  FORBIDDEN: {
    status: 403,
    data: ManagementErrorDtoSchema,
  },
  CONFLICT: {
    status: 409,
    data: ManagementErrorDtoSchema,
  },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    data: ManagementErrorDtoSchema,
  },
} as const;

const SingleJobActionErrors = {
  ...ManagementMutationErrors,
  NOT_FOUND: {
    status: 404,
    data: ManagementErrorDtoSchema,
  },
} as const;

/**
 * oRPC contract for the versioned Monque management HTTP API.
 *
 * The contract is REST-shaped under `/api/v1` and is exported for consumers that want
 * type-level route information or their own oRPC integration. Runtime support for mutation
 * routes still depends on the methods available on `ManagementOptions.monque`.
 */
export const managementContract = {
  processingState: oc
    .meta(
      openapi({
        method: "GET",
        path: "/api/v1/processing",
        operationId: "getProcessingState",
        successStatus: 200,
      }),
    )
    .input(ProcessingQueryDtoSchema.optional())
    .errors(ManagementMutationErrors)
    .output(ProcessingStateDtoSchema),
  pauseProcessing: oc
    .meta(
      openapi({
        method: "POST",
        path: "/api/v1/processing/actions/pause",
        operationId: "pauseProcessing",
        successStatus: 200,
      }),
    )
    .input(ProcessingActionDtoSchema)
    .errors(ManagementMutationErrors)
    .output(ProcessingStateDtoSchema),
  resumeProcessing: oc
    .meta(
      openapi({
        method: "POST",
        path: "/api/v1/processing/actions/resume",
        operationId: "resumeProcessing",
        successStatus: 200,
      }),
    )
    .input(ProcessingActionDtoSchema)
    .errors(ManagementMutationErrors)
    .output(ProcessingStateDtoSchema),
  selectedJobActions: oc
    .meta(
      openapi({
        method: "POST",
        path: "/api/v1/jobs/actions/selected",
        operationId: "selectedJobActions",
        successStatus: 200,
        successDescription: "Per-job action outcomes",
      }),
    )
    .input(SelectedJobActionsDtoSchema)
    .errors(ManagementMutationErrors)
    .output(BulkActionResultDtoSchema),
  health: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/health",
        operationId: "getSchedulerHealth",
        successStatus: 200,
      }),
    )
    .output(SchedulerHealthDtoSchema),
  capabilities: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/capabilities",
        operationId: "getCapabilities",
        successStatus: 200,
      }),
    )
    .input(ProcessingQueryDtoSchema.optional())
    .output(CapabilitiesDtoSchema),
  queueViews: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/queue-views",
        operationId: "listQueueViews",
        successStatus: 200,
      }),
    )
    .input(QueueViewQueryDtoSchema.optional())
    .output(QueueViewSummaryListDtoSchema),
  jobs: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/jobs",
        operationId: "listJobs",
        successStatus: 200,
      }),
    )
    .input(JobListQueryDtoSchema)
    .output(JobCursorPageDtoSchema),
  jobStats: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/jobs/stats",
        operationId: "getJobStats",
        successStatus: 200,
      }),
    )
    .input(JobStatsQueryDtoSchema)
    .output(QueueStatsDtoSchema),
  job: oc
    .meta(
      openapi({
        successDescription,
        method: "GET",
        path: "/api/v1/jobs/{id}",
        operationId: "getJob",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(JobDetailInputDtoSchema)
    .output(JobDtoSchema),
  cancelJob: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/{id}/actions/cancel",
        operationId: "cancelJob",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(JobDetailInputDtoSchema)
    .errors(SingleJobActionErrors)
    .output(JobDtoSchema),
  retryJob: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/{id}/actions/retry",
        operationId: "retryJob",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(JobDetailInputDtoSchema)
    .errors(SingleJobActionErrors)
    .output(JobDtoSchema),
  rescheduleJob: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/{id}/actions/reschedule",
        operationId: "rescheduleJob",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(RescheduleJobInputDtoSchema)
    .errors(SingleJobActionErrors)
    .output(JobDtoSchema),
  setJobPriority: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/{id}/actions/priority",
        operationId: "setJobPriority",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(SetJobPriorityInputDtoSchema)
    .errors(SingleJobActionErrors)
    .output(JobDtoSchema),
  deleteJob: oc
    .meta(
      openapi({
        successDescription,
        method: "DELETE",
        path: "/api/v1/jobs/{id}",
        operationId: "deleteJob",
        successStatus: 200,
        inputStructure: "detailed",
      }),
    )
    .input(JobDetailInputDtoSchema)
    .errors(SingleJobActionErrors)
    .output(DeleteJobDtoSchema),
  cancelJobs: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/actions/cancel",
        operationId: "cancelJobs",
        successStatus: 200,
      }),
    )
    .input(JobSelectorDtoSchema)
    .errors(ManagementMutationErrors)
    .output(BulkActionResultDtoSchema),
  retryJobs: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/actions/retry",
        operationId: "retryJobs",
        successStatus: 200,
      }),
    )
    .input(JobSelectorDtoSchema)
    .errors(ManagementMutationErrors)
    .output(BulkActionResultDtoSchema),
  deleteJobs: oc
    .meta(
      openapi({
        successDescription,
        method: "POST",
        path: "/api/v1/jobs/actions/delete",
        operationId: "deleteJobs",
        successStatus: 200,
      }),
    )
    .input(JobSelectorDtoSchema)
    .errors(ManagementMutationErrors)
    .output(BulkActionResultDtoSchema),
};

/** Type-level representation of the management oRPC contract. */
export type ManagementContract = typeof managementContract;
