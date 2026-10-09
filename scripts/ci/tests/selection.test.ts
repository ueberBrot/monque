import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

interface GateJob {
  result?: string;
  outputs?: { runtime?: string };
}
interface GateNeeds {
  [job: string]: GateJob;
}

const scope = fileURLToPath(new URL("../scope.sh", import.meta.url));
const gate = fileURLToPath(new URL("../gate.sh", import.meta.url));

const status = (needs: GateNeeds) =>
  spawnSync("bash", [gate], {
    env: { ...process.env, CI_NEEDS: JSON.stringify(needs) },
    encoding: "utf-8",
  }).status;

describe("CI change selection", () => {
  it("scope selects docs-only changes, runtime changes, moves, and missing history safely", () => {
    const cwd = mkdtempSync(nodePath.join(tmpdir(), "monque-ci-scope-"));
    const output = nodePath.join(cwd, ".git", "output");
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    const commit = () => {
      git("add", "-A");
      git("commit", "--quiet", "--no-verify", "-m", "fixture");
    };
    const write = (path: string) => {
      mkdirSync(nodePath.dirname(nodePath.join(cwd, path)), { recursive: true });
      writeFileSync(nodePath.join(cwd, path), "fixture\n");
    };
    const select = (base: string) => {
      writeFileSync(output, "");
      const result = spawnSync("bash", [scope], {
        cwd,
        env: { ...process.env, BASE_SHA: base, GITHUB_OUTPUT: output },
        encoding: "utf-8",
      });
      expect(result.status, result.stderr).toBe(0);
      return readFileSync(output, "utf-8").trim();
    };
    try {
      git("init", "--quiet");
      git("config", "user.email", "ci@example.invalid");
      git("config", "user.name", "CI test");
      git("remote", "add", "origin", cwd);
      write("runtime.ts");
      commit();
      const base = git("rev-parse", "HEAD");
      for (const path of [
        "apps/docs/astro.config.mjs",
        "docs/adr/one.md",
        "README.md",
        ".changeset/update.md",
        "notes with\nnewline.md",
      ]) {
        write(path);
      }
      commit();
      expect(select(base)).toBe("runtime=false");
      for (const path of [
        "bun.lock",
        "package.json",
        "vite.config.ts",
        ".github/workflows/ci.yml",
        "packages/core/src/index.ts",
        "apps/dashboard-dev/src/main.ts",
        "docs/tool.ts",
        "unknown",
      ]) {
        const previous = git("rev-parse", "HEAD");
        write(path);
        commit();
        expect(select(previous), path).toBe("runtime=true");
      }
      const beforeMove = git("rev-parse", "HEAD");
      renameSync(nodePath.join(cwd, "runtime.ts"), nodePath.join(cwd, "moved.md"));
      commit();
      expect(select(beforeMove)).toBe("runtime=true");
      for (const revision of [
        "",
        "0".repeat(40),
        "--help",
        "f".repeat(40),
        git("rev-parse", "HEAD"),
      ]) {
        expect(select(revision)).toBe("runtime=true");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("gate accepts only expected success/skips and rejects missing outputs, failures and cancellations", () => {
    for (const runtime of ["true", "false"]) {
      const expected = runtime === "true" ? "success" : "skipped";
      const needs = {
        quality: { result: "success", outputs: { runtime } },
        "build-apps": { result: "success" },
        test: { result: expected },
        "dashboard-e2e": { result: expected },
      };
      expect(status(needs)).toBe(0);
      for (const job of Object.keys(needs)) {
        for (const result of ["failure", "cancelled", "skipped", "success"]) {
          if (result === (job === "quality" || job === "build-apps" ? "success" : expected)) {
            continue;
          }
          expect(status({ ...needs, [job]: { result } })).not.toBe(0);
        }
      }
      expect(status({ ...needs, quality: { result: "success" } })).not.toBe(0);
    }
    expect(status({})).not.toBe(0);
  });
});
