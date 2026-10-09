/**
 * Unit tests for MonqueService (T022)
 */
import { JobStatus } from "@monque/core";
import type { Monque } from "@monque/core";
import { fromPartial } from "@total-typescript/shoehorn";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Mock } from "vite-plus/test";

import { MonqueService } from "@/services";

interface MockMonque {
  enqueue: Mock<Monque["enqueue"]>;
  now: Mock<Monque["now"]>;
  schedule: Mock<Monque["schedule"]>;
  cancelJob: Mock<Monque["cancelJob"]>;
  retryJob: Mock<Monque["retryJob"]>;
  rescheduleJob: Mock<Monque["rescheduleJob"]>;
  deleteJob: Mock<Monque["deleteJob"]>;
  cancelJobs: Mock<Monque["cancelJobs"]>;
  retryJobs: Mock<Monque["retryJobs"]>;
  deleteJobs: Mock<Monque["deleteJobs"]>;
  getJob: Mock<Monque["getJob"]>;
  getJobs: Mock<Monque["getJobs"]>;
  getJobsWithCursor: Mock<Monque["getJobsWithCursor"]>;
  getQueueStats: Mock<Monque["getQueueStats"]>;
  isHealthy: Mock<Monque["isHealthy"]>;
}

describe(MonqueService, () => {
  const firstJobId = new ObjectId();
  const secondJobId = new ObjectId();
  const thirdJobId = new ObjectId();
  let service: MonqueService;

  beforeEach(() => {
    service = new MonqueService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("before initialization", () => {
    it("should throw when accessing monque before initialization", () => {
      expect(() => service.monque).toThrow("MonqueService is not initialized");
    });

    it("should throw when calling enqueue before initialization", async () => {
      await expect(service.enqueue("test", {})).rejects.toThrow("MonqueService is not initialized");
    });

    it("should throw when calling now before initialization", async () => {
      await expect(service.now("test", {})).rejects.toThrow("MonqueService is not initialized");
    });

    it("should throw when calling schedule before initialization", async () => {
      await expect(service.schedule("* * * * *", "test", {})).rejects.toThrow(
        "MonqueService is not initialized",
      );
    });
  });

  describe("after initialization", () => {
    let mockMonque: MockMonque;

    beforeEach(() => {
      mockMonque = {
        enqueue: vi.fn<Monque["enqueue"]>().mockResolvedValue(fromPartial({ _id: firstJobId })),
        now: vi.fn<Monque["now"]>().mockResolvedValue(fromPartial({ _id: secondJobId })),
        schedule: vi.fn<Monque["schedule"]>().mockResolvedValue(fromPartial({ _id: thirdJobId })),
        cancelJob: vi
          .fn<Monque["cancelJob"]>()
          .mockResolvedValue(fromPartial({ _id: firstJobId, status: JobStatus.CANCELLED })),
        retryJob: vi
          .fn<Monque["retryJob"]>()
          .mockResolvedValue(fromPartial({ _id: firstJobId, status: JobStatus.PENDING })),
        rescheduleJob: vi
          .fn<Monque["rescheduleJob"]>()
          .mockResolvedValue(fromPartial({ _id: firstJobId })),
        deleteJob: vi.fn<Monque["deleteJob"]>().mockResolvedValue(fromPartial(true)),
        cancelJobs: vi.fn<Monque["cancelJobs"]>().mockResolvedValue(fromPartial({ count: 5 })),
        retryJobs: vi.fn<Monque["retryJobs"]>().mockResolvedValue(fromPartial({ count: 3 })),
        deleteJobs: vi.fn<Monque["deleteJobs"]>().mockResolvedValue(fromPartial({ count: 10 })),
        getJob: vi.fn<Monque["getJob"]>().mockResolvedValue(fromPartial({ _id: firstJobId })),
        getJobs: vi.fn<Monque["getJobs"]>().mockResolvedValue(fromPartial([{ _id: firstJobId }])),
        getJobsWithCursor: vi
          .fn<Monque["getJobsWithCursor"]>()
          .mockResolvedValue(
            fromPartial({ jobs: [], cursor: null, hasNextPage: false, hasPreviousPage: false }),
          ),
        getQueueStats: vi
          .fn<Monque["getQueueStats"]>()
          .mockResolvedValue(fromPartial({ pending: 5, completed: 10 })),
        isHealthy: vi.fn<Monque["isHealthy"]>().mockReturnValue(true),
      };

      // Use internal method to set the monque instance
      service._setMonque(fromPartial(mockMonque));
    });

    it("should return monque instance", () => {
      expect(service.monque).toBe(mockMonque);
    });

    describe("job scheduling", () => {
      it("should delegate enqueue to monque", async () => {
        const result = await service.enqueue("test", { data: "value" }, { runAt: new Date() });

        const runAt: unknown = expect.any(Date);
        expect(mockMonque.enqueue).toHaveBeenCalledWith("test", { data: "value" }, { runAt });
        expect(result).toStrictEqual({ _id: firstJobId });
      });

      it("should delegate now to monque", async () => {
        const result = await service.now("test", { data: "value" });

        expect(mockMonque.now).toHaveBeenCalledWith("test", { data: "value" }, undefined);
        expect(result).toStrictEqual({ _id: secondJobId });
      });

      it("should delegate schedule to monque", async () => {
        const result = await service.schedule("0 9 * * *", "daily", { report: true });

        expect(mockMonque.schedule).toHaveBeenCalledWith(
          "0 9 * * *",
          "daily",
          { report: true },
          undefined,
        );
        expect(result).toStrictEqual({ _id: thirdJobId });
      });
    });

    describe("single job management", () => {
      it("should delegate cancelJob to monque", async () => {
        const result = await service.cancelJob("job-1");
        expect(mockMonque.cancelJob).toHaveBeenCalledWith("job-1");
        expect(result).toStrictEqual({ _id: firstJobId, status: JobStatus.CANCELLED });
      });

      it("should delegate retryJob to monque", async () => {
        const result = await service.retryJob("job-1");
        expect(mockMonque.retryJob).toHaveBeenCalledWith("job-1");
        expect(result).toStrictEqual({ _id: firstJobId, status: JobStatus.PENDING });
      });

      it("should delegate rescheduleJob to monque", async () => {
        const newDate = new Date();
        const result = await service.rescheduleJob("job-1", newDate);
        expect(mockMonque.rescheduleJob).toHaveBeenCalledWith("job-1", newDate);
        expect(result).toStrictEqual({ _id: firstJobId });
      });

      it("should delegate deleteJob to monque", async () => {
        const result = await service.deleteJob("job-1");
        expect(mockMonque.deleteJob).toHaveBeenCalledWith("job-1");
        expect(result).toBe(true);
      });
    });

    describe("bulk operations", () => {
      it("should delegate cancelJobs to monque", async () => {
        const filter = { name: "test" };
        const result = await service.cancelJobs(filter);
        expect(mockMonque.cancelJobs).toHaveBeenCalledWith(filter);
        expect(result).toStrictEqual({ count: 5 });
      });

      it("should delegate retryJobs to monque", async () => {
        const filter = { status: JobStatus.FAILED } as const;
        const result = await service.retryJobs(filter);
        expect(mockMonque.retryJobs).toHaveBeenCalledWith(filter);
        expect(result).toStrictEqual({ count: 3 });
      });

      it("should delegate deleteJobs to monque", async () => {
        const filter = { name: "old" };
        const result = await service.deleteJobs(filter);
        expect(mockMonque.deleteJobs).toHaveBeenCalledWith(filter);
        expect(result).toStrictEqual({ count: 10 });
      });
    });

    describe("job queries", () => {
      it("should delegate getJob to monque", async () => {
        const validObjectId = "507f1f77bcf86cd799439011";
        const result = await service.getJob(validObjectId);
        expect(mockMonque.getJob).toHaveBeenCalledWith(expect.any(ObjectId));
        const calledArg = mockMonque.getJob.mock.calls[0]?.[0];
        expect(calledArg instanceof ObjectId && calledArg.toHexString()).toBe(validObjectId);
        expect(result).toStrictEqual({ _id: firstJobId });
      });

      it("should delegate getJob to monque with ObjectId", async () => {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        const result = await service.getJob(id);
        expect(mockMonque.getJob).toHaveBeenCalledWith(id);
        expect(result).toStrictEqual({ _id: firstJobId });
      });

      it("should throw MonqueError when calling getJob with invalid hex string", async () => {
        await expect(service.getJob("invalid-hex-string")).rejects.toThrow(
          "Invalid job ID format: invalid-hex-string",
        );
      });

      it("should delegate getJobs to monque", async () => {
        const filter = { limit: 10 };
        const result = await service.getJobs(filter);
        expect(mockMonque.getJobs).toHaveBeenCalledWith(filter);
        expect(result).toStrictEqual([{ _id: firstJobId }]);
      });

      it("should delegate getJobsWithCursor to monque", async () => {
        const options = { limit: 20 };
        const result = await service.getJobsWithCursor(options);
        expect(mockMonque.getJobsWithCursor).toHaveBeenCalledWith(options);
        expect(result).toStrictEqual({
          jobs: [],
          cursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        });
      });

      it("should delegate getQueueStats to monque", async () => {
        const result = await service.getQueueStats({ name: "email" });
        expect(mockMonque.getQueueStats).toHaveBeenCalledWith({ name: "email" });
        expect(result).toStrictEqual({ pending: 5, completed: 10 });
      });
    });

    describe("health check", () => {
      it("should delegate isHealthy to monque", () => {
        const result = service.isHealthy();
        expect(mockMonque.isHealthy).toHaveBeenCalledWith();
        expect(result).toBe(true);
      });
    });
  });
});
