/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
/**
 * Unit tests for @Job decorator (T021)
 */
import { Store } from "@tsed/core";
import { describe, expect, it } from "vite-plus/test";

import { MONQUE } from "@/constants";
import { Job, JobController } from "@/decorators";
import type { JobStore } from "@/decorators";

describe("@Job", () => {
  describe("basic decoration", () => {
    it("should add job metadata to the controller store", () => {
      @JobController("email")
      class EmailJob {
        @Job("send")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        sendEmail() {}
      }

      const store = Store.from(EmailJob);
      const monqueStore = store.get<JobStore>(MONQUE);

      expect(monqueStore?.jobs).toHaveLength(1);
      expect(monqueStore?.jobs[0]).toStrictEqual({
        name: "send",
        method: "sendEmail",
        opts: {},
      });
    });

    it("should support multiple jobs on same controller", () => {
      @JobController("notifications")
      class NotificationJob {
        @Job("email")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        sendEmail() {}

        @Job("sms")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        sendSms() {}

        @Job("push")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        sendPush() {}
      }

      const store = Store.from(NotificationJob);
      const monqueStore = store.get<JobStore>(MONQUE);

      expect(monqueStore?.jobs).toHaveLength(3);
      expect(monqueStore?.jobs.map((job) => job.name)).toStrictEqual(["email", "sms", "push"]);
    });
  });

  describe("options handling", () => {
    it("should store concurrency option", () => {
      @JobController("test")
      class TestJob {
        @Job("process", { concurrency: 10 })
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        process() {}
      }

      const store = Store.from(TestJob);
      const monqueStore = store.get<JobStore>(MONQUE);
      const jobs = monqueStore?.jobs;

      expect(jobs?.[0]?.opts).toStrictEqual({
        concurrency: 10,
      });
    });

    it("should store replace option", () => {
      @JobController("test")
      class TestJob {
        @Job("unique", { replace: true })
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        unique() {}
      }

      const store = Store.from(TestJob);
      const monqueStore = store.get<JobStore>(MONQUE);
      const jobs = monqueStore?.jobs;

      expect(jobs?.[0]?.opts).toStrictEqual({
        replace: true,
      });
    });

    it("should store multiple options together", () => {
      @JobController("test")
      class TestJob {
        @Job("multi", { concurrency: 5, replace: false })
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        multi() {}
      }

      const store = Store.from(TestJob);
      const monqueStore = store.get<JobStore>(MONQUE);
      const jobs = monqueStore?.jobs;

      expect(jobs?.[0]?.opts).toStrictEqual({
        concurrency: 5,
        replace: false,
      });
    });
  });

  describe("without JobController", () => {
    it("should initialize MONQUE store if not present", () => {
      // Test that @Job can be applied even if @JobController hasn't been applied yet
      // (decorators are applied bottom-up)
      class PlainClass {
        @Job("test")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        test() {}
      }

      const store = Store.from(PlainClass);
      const monqueStore = store.get<JobStore>(MONQUE);

      // The @Job decorator should create/merge into the store
      expect(monqueStore?.jobs).toHaveLength(1);
    });

    it("should handle missing jobs array in existing store", () => {
      // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
      class TestClass {}
      const store = Store.from(TestClass);
      // Seed store with a partial object missing the jobs array.
      store.set(MONQUE, { type: "controller" });

      // Apply decorator manually
      const decorator = Job("test");
      decorator(TestClass.prototype, "method", {});

      const res = store.get<JobStore>(MONQUE);
      expect(res.jobs).toHaveLength(1);
    });
  });
});
