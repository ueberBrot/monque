import { ORPCError, ResponseError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import { getActionErrorFeedback } from "@/features/jobs/job-actions";
import { readManagementError, resolveDashboardApiErrorState } from "@/management-errors";

describe("Management error presentation", () => {
  it.each([
    new ORPCError("FORBIDDEN", { message: "Forbidden", data: { error: "Session has expired." } }),
    new ResponseError({
      message: "Session has expired.",
      response: { status: 403, headers: {}, body: { error: "Session has expired." } },
    }),
  ])("preserves the host message across queries, job details and actions", (failure) => {
    expect(readManagementError(failure)).toStrictEqual({
      status: 403,
      message: "Session has expired.",
    });
    expect(resolveDashboardApiErrorState(failure).description).toBe("Session has expired.");
    expect(resolveDashboardApiErrorState(failure, "job")).toMatchObject({
      code: "forbidden",
      description: "Session has expired.",
    });
    expect(getActionErrorFeedback(failure)).toMatchObject({
      title: "Action unavailable",
      description: "Session has expired.",
    });
  });

  it("retains error status when the host sends malformed optional details", () => {
    const failure = new ORPCError("UNAUTHORIZED", { data: { error: 42 }, message: "" });
    expect(readManagementError(failure).status).toBe(401);
    expect(resolveDashboardApiErrorState(failure, "job").code).toBe("unauthorized");
    expect(readManagementError(failure).message).toBeUndefined();
  });

  it.each([undefined, null, "broken", 42, { data: { error: {} } }])(
    "uses contextual fallbacks for an unknown failure: %j",
    (failure) => {
      expect(readManagementError(failure).message).toBeUndefined();
      expect(resolveDashboardApiErrorState(failure, "job").code).toBe("error");
      expect(getActionErrorFeedback(failure).title).toBe("Action failed");
    },
  );

  it.each(["health", "jobs", "job", "queue-views"] as const)(
    "classifies access failures for %s without overriding host messages",
    (resource) => {
      for (const [errorCode, code] of [
        ["UNAUTHORIZED", "unauthorized"],
        ["FORBIDDEN", "forbidden"],
      ] as const) {
        expect(
          resolveDashboardApiErrorState(
            new ORPCError(errorCode, { message: "Host explanation" }),
            resource,
            "Loading failed",
          ),
        ).toMatchObject({ code, description: "Host explanation" });
        expect(
          resolveDashboardApiErrorState(new ORPCError(errorCode), resource, "Loading failed").title,
        ).not.toBe("Loading failed");
      }
    },
  );

  it("treats a missing Job differently from a missing collection endpoint", () => {
    expect(resolveDashboardApiErrorState(new ORPCError("NOT_FOUND"), "job")).toMatchObject({
      code: "not-found",
      title: "Job not found",
      tone: "default",
    });

    for (const resource of ["health", "jobs", "queue-views"] as const) {
      expect(resolveDashboardApiErrorState(new ORPCError("NOT_FOUND"), resource).code).toBe(
        "error",
      );
    }
  });

  it("retains a Queue View name only in generic failure headings", () => {
    expect(
      resolveDashboardApiErrorState(
        new ORPCError("INTERNAL_SERVER_ERROR"),
        "queue-views",
        "email failed to load",
      ),
    ).toMatchObject({ title: "email failed to load", code: "error" });
    expect(
      resolveDashboardApiErrorState(
        new ORPCError("FORBIDDEN"),
        "queue-views",
        "email failed to load",
      ).title,
    ).toBe("Access denied");
  });

  it("preserves ordinary network error messages", () => {
    expect(readManagementError(new Error("Network unavailable")).message).toBe(
      "Network unavailable",
    );
  });

  it("uses the transport status when a host maps a custom error code", () => {
    const failure = new ORPCError("SESSION_EXPIRED", {
      message: "Sign in again",
      cause: new ResponseError({ response: { status: 401, headers: {}, body: {} } }),
    });

    expect(resolveDashboardApiErrorState(failure)).toMatchObject({
      code: "unauthorized",
      description: "Sign in again",
    });
  });
});
