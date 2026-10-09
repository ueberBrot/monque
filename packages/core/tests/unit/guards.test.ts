import { fromAny } from "@total-typescript/shoehorn";
import type { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  isCancelledJob,
  isCompletedJob,
  isFailedJob,
  isPendingJob,
  isPersistedJob,
  isProcessingJob,
  isRecurringJob,
  isValidJobStatus,
  JobStatus,
} from "@/jobs";
import type { Job } from "@/jobs";
import { JobFactory, JobFactoryHelpers } from "@tests/factories";

describe("job guards", () => {
  let baseJob: Job;
  beforeEach(() => {
    baseJob = JobFactory.build();
  });
  describe(isPersistedJob, () => {
    it("should return true for job with _id", () => {
      const persistedJob = JobFactory.build();
      expect(isPersistedJob(persistedJob)).toBe(true);
    });

    it("should return false for job without _id", () => {
      const jobWithoutId = { ...baseJob };
      delete jobWithoutId._id;
      expect(isPersistedJob(jobWithoutId)).toBe(false);
    });

    it("should return false when _id is undefined", () => {
      const job = { ...baseJob };
      Object.defineProperty(job, "_id", { value: undefined });
      expect(isPersistedJob(job)).toBe(false);
    });

    it("should return false when _id is null", () => {
      const jobWithNullId = {
        ...baseJob,
        _id: fromAny<ObjectId, unknown>(null),
      };
      expect(isPersistedJob(jobWithNullId)).toBe(false);
    });
  });
  describe(isValidJobStatus, () => {
    it("should return true for PENDING status", () => {
      expect({
        isValidJobStatusJobStatusPENDING: isValidJobStatus(JobStatus.PENDING),
        isValidJobStatusPending: isValidJobStatus("pending"),
      }).toStrictEqual({
        isValidJobStatusJobStatusPENDING: true,
        isValidJobStatusPending: true,
      });
    });

    it("should return true for PROCESSING status", () => {
      expect({
        isValidJobStatusJobStatusPROCESSING: isValidJobStatus(JobStatus.PROCESSING),
        isValidJobStatusProcessing: isValidJobStatus("processing"),
      }).toStrictEqual({
        isValidJobStatusJobStatusPROCESSING: true,
        isValidJobStatusProcessing: true,
      });
    });

    it("should return true for COMPLETED status", () => {
      expect({
        isValidJobStatusJobStatusCOMPLETED: isValidJobStatus(JobStatus.COMPLETED),
        isValidJobStatusCompleted: isValidJobStatus("completed"),
      }).toStrictEqual({
        isValidJobStatusJobStatusCOMPLETED: true,
        isValidJobStatusCompleted: true,
      });
    });

    it("should return true for FAILED status", () => {
      expect({
        isValidJobStatusJobStatusFAILED: isValidJobStatus(JobStatus.FAILED),
        isValidJobStatusFailed: isValidJobStatus("failed"),
      }).toStrictEqual({
        isValidJobStatusJobStatusFAILED: true,
        isValidJobStatusFailed: true,
      });
    });

    it("should return true for CANCELLED status", () => {
      expect({
        isValidJobStatusJobStatusCANCELLED: isValidJobStatus(JobStatus.CANCELLED),
        isValidJobStatusCancelled: isValidJobStatus("cancelled"),
      }).toStrictEqual({
        isValidJobStatusJobStatusCANCELLED: true,
        isValidJobStatusCancelled: true,
      });
    });

    it("should return false for invalid string", () => {
      expect({
        isValidJobStatusInvalid: isValidJobStatus("invalid"),
        isValidJobStatusPENDING: isValidJobStatus("PENDING"),
        isValidJobStatus: isValidJobStatus(""),
      }).toStrictEqual({
        isValidJobStatusInvalid: false,
        isValidJobStatusPENDING: false,
        isValidJobStatus: false,
      });
    });

    it("should return false for non-string types", () => {
      expect({
        isValidJobStatus123: isValidJobStatus(123),
        isValidJobStatusNull: isValidJobStatus(null),
        isValidJobStatusUndefined: isValidJobStatus(undefined),
        isValidJobStatus: isValidJobStatus({}),
        isValidJobStatus2: isValidJobStatus([]),
        isValidJobStatusTrue: isValidJobStatus(true),
      }).toStrictEqual({
        isValidJobStatus123: false,
        isValidJobStatusNull: false,
        isValidJobStatusUndefined: false,
        isValidJobStatus: false,
        isValidJobStatus2: false,
        isValidJobStatusTrue: false,
      });
    });
  });
  describe(isPendingJob, () => {
    it("should return true when status is PENDING", () => {
      const job = JobFactory.build({ status: JobStatus.PENDING });
      expect(isPendingJob(job)).toBe(true);
    });

    it("should return false when status is not PENDING", () => {
      expect({
        isPendingJobJobFactoryHelpersProcessing: isPendingJob(JobFactoryHelpers.processing()),
        isPendingJobJobFactoryHelpersCompleted: isPendingJob(JobFactoryHelpers.completed()),
        isPendingJobJobFactoryHelpersFailed: isPendingJob(JobFactoryHelpers.failed()),
      }).toStrictEqual({
        isPendingJobJobFactoryHelpersProcessing: false,
        isPendingJobJobFactoryHelpersCompleted: false,
        isPendingJobJobFactoryHelpersFailed: false,
      });
    });
  });
  describe(isProcessingJob, () => {
    it("should return true when status is PROCESSING", () => {
      const job = JobFactoryHelpers.processing();
      expect(isProcessingJob(job)).toBe(true);
    });

    it("should return false when status is not PROCESSING", () => {
      expect({
        isProcessingJobJobFactoryBuildStatusJobStatusPENDING: isProcessingJob(
          JobFactory.build({ status: JobStatus.PENDING }),
        ),
        isProcessingJobJobFactoryHelpersCompleted: isProcessingJob(JobFactoryHelpers.completed()),
        isProcessingJobJobFactoryHelpersFailed: isProcessingJob(JobFactoryHelpers.failed()),
      }).toStrictEqual({
        isProcessingJobJobFactoryBuildStatusJobStatusPENDING: false,
        isProcessingJobJobFactoryHelpersCompleted: false,
        isProcessingJobJobFactoryHelpersFailed: false,
      });
    });
  });
  describe(isCompletedJob, () => {
    it("should return true when status is COMPLETED", () => {
      const job = JobFactoryHelpers.completed();
      expect(isCompletedJob(job)).toBe(true);
    });

    it("should return false when status is not COMPLETED", () => {
      expect({
        isCompletedJobJobFactoryBuildStatusJobStatusPENDING: isCompletedJob(
          JobFactory.build({ status: JobStatus.PENDING }),
        ),
        isCompletedJobJobFactoryHelpersProcessing: isCompletedJob(JobFactoryHelpers.processing()),
        isCompletedJobJobFactoryHelpersFailed: isCompletedJob(JobFactoryHelpers.failed()),
      }).toStrictEqual({
        isCompletedJobJobFactoryBuildStatusJobStatusPENDING: false,
        isCompletedJobJobFactoryHelpersProcessing: false,
        isCompletedJobJobFactoryHelpersFailed: false,
      });
    });
  });
  describe(isFailedJob, () => {
    it("should return true when status is FAILED", () => {
      const job = JobFactoryHelpers.failed();
      expect(isFailedJob(job)).toBe(true);
    });

    it("should return false when status is not FAILED", () => {
      expect({
        isFailedJobJobFactoryBuildStatusJobStatusPENDING: isFailedJob(
          JobFactory.build({ status: JobStatus.PENDING }),
        ),
        isFailedJobJobFactoryHelpersProcessing: isFailedJob(JobFactoryHelpers.processing()),
        isFailedJobJobFactoryHelpersCompleted: isFailedJob(JobFactoryHelpers.completed()),
      }).toStrictEqual({
        isFailedJobJobFactoryBuildStatusJobStatusPENDING: false,
        isFailedJobJobFactoryHelpersProcessing: false,
        isFailedJobJobFactoryHelpersCompleted: false,
      });
    });
  });
  describe(isCancelledJob, () => {
    it("should return true when status is CANCELLED", () => {
      const job = JobFactoryHelpers.cancelled();
      expect(isCancelledJob(job)).toBe(true);
    });

    it("should return false when status is not CANCELLED", () => {
      expect({
        isCancelledJobJobFactoryBuildStatusJobStatusPENDING: isCancelledJob(
          JobFactory.build({ status: JobStatus.PENDING }),
        ),
        isCancelledJobJobFactoryHelpersProcessing: isCancelledJob(JobFactoryHelpers.processing()),
        isCancelledJobJobFactoryHelpersCompleted: isCancelledJob(JobFactoryHelpers.completed()),
        isCancelledJobJobFactoryHelpersFailed: isCancelledJob(JobFactoryHelpers.failed()),
      }).toStrictEqual({
        isCancelledJobJobFactoryBuildStatusJobStatusPENDING: false,
        isCancelledJobJobFactoryHelpersProcessing: false,
        isCancelledJobJobFactoryHelpersCompleted: false,
        isCancelledJobJobFactoryHelpersFailed: false,
      });
    });
  });
  describe(isRecurringJob, () => {
    it("should return true when repeatInterval is defined", () => {
      const job = JobFactory.build({ repeatInterval: "0 * * * *" });
      expect(isRecurringJob(job)).toBe(true);
    });

    it("should return false when repeatInterval is undefined", () => {
      const job = JobFactory.build();
      expect(isRecurringJob(job)).toBe(false);
    });

    it("should return false when repeatInterval is null", () => {
      const job = JobFactory.build({ repeatInterval: fromAny<string, unknown>(null) });
      expect(isRecurringJob(job)).toBe(false);
    });

    it("should return true for empty string repeatInterval", () => {
      // Even empty string means it's defined as recurring (though invalid cron)
      const job = JobFactory.build({ repeatInterval: "" });
      expect(isRecurringJob(job)).toBe(true);
    });
  });
});
