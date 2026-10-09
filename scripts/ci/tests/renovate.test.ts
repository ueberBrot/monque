import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

const generator = fileURLToPath(new URL("../../renovate-generate-changeset.ts", import.meta.url));
const directories: string[] = [];

const repository = () => {
  const cwd = mkdtempSync(nodePath.join(tmpdir(), "monque-renovate-"));
  directories.push(cwd);
  const output = nodePath.join(cwd, ".git", "output");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  const write = (path: string, value: JsonValue) => {
    mkdirSync(nodePath.dirname(nodePath.join(cwd, path)), { recursive: true });
    writeFileSync(nodePath.join(cwd, path), JSON.stringify(value));
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "--quiet", "--no-verify", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const generate = (base: string, head: string) => {
    rmSync(output, { force: true });
    const result = spawnSync(process.execPath, [generator], {
      cwd,
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
      encoding: "utf-8",
    });
    return {
      result,
      generated: existsSync(output)
        ? readFileSync(output, "utf-8").trim().replace("commit=", "")
        : null,
    };
  };
  git("init", "--quiet");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "CI test");
  return { cwd, git, write, commit, generate };
};

describe("Renovate changesets", () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates a changeset commit from pinned PR manifests without executing or checking out PR files", () => {
    const { cwd, git, write, commit, generate } = repository();
    write("package.json", { catalog: { mongodb: "6.0.0" } });
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "catalog:" },
    });
    write("packages/private/package.json", {
      name: "private",
      private: true,
      dependencies: { mongodb: "catalog:" },
    });
    const base = commit();
    write("package.json", {
      catalog: { mongodb: "7.0.0" },
      scripts: { prepare: "touch untrusted-code-ran" },
    });
    write("scripts/renovate-generate-changeset.ts", "throw new Error('untrusted')");
    const head = commit();
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "99.0.0" },
    });
    commit();
    git("checkout", "--quiet", base);
    const { result, generated } = generate(base, head);
    expect(result.status, result.stderr).toBe(0);
    expect(git("rev-parse", `${generated}^`)).toBe(head);
    expect(git("diff", "--name-only", head, `${generated}`)).toMatch(
      /^\.changeset\/renovate-deps-[0-9a-f]{16}\.md$/u,
    );
    expect({
      changeset: git("show", `${generated}:${git("diff", "--name-only", head, `${generated}`)}`),
      generator: git("show", `${generated}:scripts/renovate-generate-changeset.ts`),
    }).toStrictEqual({
      changeset: '---\n"@monque/core": minor\n---\n\nUpdate runtime dependencies.',
      generator: JSON.stringify("throw new Error('untrusted')"),
    });
    expect({
      ranUntrustedCode: existsSync(nodePath.join(cwd, "untrusted-code-ran")),
      head: git("rev-parse", "HEAD"),
      status: git("status", "--porcelain"),
    }).toStrictEqual({ ranUntrustedCode: false, head: base, status: "" });
  });

  it("groups optional and peer dependency updates with named catalogs into one changeset", () => {
    const { git, write, commit, generate } = repository();
    write("package.json", { catalogs: { runtime: { express: "4.0.0" } } });
    write("packages/adapter/package.json", {
      name: "@monque/adapter",
      optionalDependencies: { express: "catalog:runtime" },
      peerDependencies: { monque: "1.0.0" },
      devDependencies: { tooling: "1.0.0" },
    });
    const base = commit();
    write("package.json", { catalogs: { runtime: { express: "5.0.0" } } });
    write("packages/adapter/package.json", {
      name: "@monque/adapter",
      optionalDependencies: { express: "catalog:runtime" },
      peerDependencies: { monque: "2.0.0" },
      devDependencies: { tooling: "2.0.0" },
    });
    const head = commit();
    const { result, generated } = generate(base, head);
    expect(result.status, result.stderr).toBe(0);
    const paths = git("diff", "--name-only", head, `${generated}`).split("\n");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^\.changeset\/renovate-deps-[0-9a-f]{16}\.md$/u);
    expect(git("show", `${generated}:${paths[0]}`)).toBe(
      '---\n"@monque/adapter": minor\n---\n\nUpdate runtime dependencies.',
    );
  });

  it("lists every affected published package once in sorted order and excludes other packages", () => {
    const { git, write, commit, generate } = repository();
    write("packages/zeta/package.json", {
      name: "@monque/zeta",
      dependencies: { mongodb: "6.0.0", zod: "3.0.0" },
      optionalDependencies: { express: "4.0.0" },
    });
    write("packages/alpha/package.json", {
      name: "@monque/alpha",
      dependencies: { mongodb: "6.0.0" },
      peerDependencies: { express: "4.0.0" },
    });
    write("packages/unchanged/package.json", {
      name: "@monque/unchanged",
      dependencies: { mongodb: "6.0.0" },
    });
    write("packages/dev-only/package.json", {
      name: "@monque/dev-only",
      dependencies: { mongodb: "6.0.0" },
      devDependencies: { tooling: "1.0.0" },
    });
    write("packages/private/package.json", {
      name: "@monque/private",
      private: true,
      dependencies: { mongodb: "6.0.0" },
    });
    write("apps/demo/package.json", {
      name: "@monque/demo",
      dependencies: { mongodb: "6.0.0" },
    });
    const base = commit();
    write("packages/zeta/package.json", {
      name: "@monque/zeta",
      dependencies: { mongodb: "7.0.0", zod: "4.0.0" },
      optionalDependencies: { express: "5.0.0" },
    });
    write("packages/alpha/package.json", {
      name: "@monque/alpha",
      dependencies: { mongodb: "7.0.0" },
      peerDependencies: { express: "5.0.0" },
    });
    write("packages/dev-only/package.json", {
      name: "@monque/dev-only",
      dependencies: { mongodb: "6.0.0" },
      devDependencies: { tooling: "2.0.0" },
    });
    write("packages/private/package.json", {
      name: "@monque/private",
      private: true,
      dependencies: { mongodb: "7.0.0" },
    });
    write("apps/demo/package.json", {
      name: "@monque/demo",
      dependencies: { mongodb: "7.0.0" },
    });
    const head = commit();
    const { result, generated } = generate(base, head);
    expect(result.status, result.stderr).toBe(0);
    const path = git("diff", "--name-only", head, `${generated}`);
    expect(path).toMatch(/^\.changeset\/renovate-deps-[0-9a-f]{16}\.md$/u);
    expect(git("show", `${generated}:${path}`)).toBe(
      '---\n"@monque/alpha": minor\n"@monque/zeta": minor\n---\n\nUpdate runtime dependencies.',
    );
  });

  it.each(["dependencies", "optionalDependencies", "peerDependencies"])(
    "generates a changeset for a standalone %s update",
    (section) => {
      const { git, write, commit, generate } = repository();
      write("packages/core/package.json", {
        name: "@monque/core",
        [section]: { mongodb: "6.0.0" },
      });
      const base = commit();
      write("packages/core/package.json", {
        name: "@monque/core",
        [section]: { mongodb: "7.0.0" },
      });
      const head = commit();
      const { result, generated } = generate(base, head);
      expect(result.status, result.stderr).toBe(0);
      const path = git("diff", "--name-only", head, `${generated}`);
      expect(path).toMatch(/^\.changeset\/renovate-deps-[0-9a-f]{16}\.md$/u);
      expect(git("show", `${generated}:${path}`)).toBe(
        '---\n"@monque/core": minor\n---\n\nUpdate runtime dependencies.',
      );
    },
  );

  it.each(["dependencies", "peerDependencies"])(
    "includes @monque dependency updates in %s",
    (section) => {
      const { git, write, commit, generate } = repository();
      write("packages/core/package.json", { name: "@monque/core" });
      write("packages/adapter/package.json", {
        name: "@monque/adapter",
        [section]: { "@monque/core": "^0.1.0" },
      });
      const base = commit();
      write("packages/adapter/package.json", {
        name: "@monque/adapter",
        [section]: { "@monque/core": "^0.2.0" },
      });
      const head = commit();
      const { result, generated } = generate(base, head);
      expect(result.status, result.stderr).toBe(0);
      const path = git("diff", "--name-only", head, `${generated}`);
      expect(path).toMatch(/^\.changeset\/renovate-deps-[0-9a-f]{16}\.md$/u);
      expect(git("show", `${generated}:${path}`)).toBe(
        '---\n"@monque/adapter": minor\n---\n\nUpdate runtime dependencies.',
      );
    },
  );

  it("does not generate a changeset for development-only dependency updates", () => {
    const { write, commit, generate } = repository();
    write("package.json", { catalog: { tooling: "1.0.0" } });
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "6.0.0" },
      devDependencies: { tooling: "catalog:", "@monque/adapter": "^0.1.0" },
    });
    const base = commit();
    write("package.json", { catalog: { tooling: "2.0.0" } });
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "6.0.0" },
      devDependencies: { tooling: "catalog:", "@monque/adapter": "^0.2.0" },
    });
    const { result, generated } = generate(base, commit());
    expect(result.status, result.stderr).toBe(0);
    expect(generated).toBeNull();
  });

  it("does not generate a changeset for lockfile-only updates", () => {
    const { write, commit, generate } = repository();
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "^6.0.0" },
    });
    write("bun.lock", { packages: { mongodb: "6.0.0" } });
    const base = commit();
    write("bun.lock", { packages: { mongodb: "6.1.0" } });
    const { result, generated } = generate(base, commit());
    expect(result.status, result.stderr).toBe(0);
    expect(generated).toBeNull();
  });

  it("leaves a PR that already provides a changeset unchanged", () => {
    const { write, commit, generate } = repository();
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "6.0.0" },
    });
    const base = commit();
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "7.0.0" },
    });
    write(".changeset/already-provided.md", "already provided");
    const head = commit();
    const { result, generated } = generate(base, head);
    expect(result.status, result.stderr).toBe(0);
    expect(generated).toBeNull();
  });

  it("ignores malformed manifests and private packages without producing a commit", () => {
    const { cwd, write, commit, generate } = repository();
    write("packages/core/package.json", {
      name: "@monque/core",
      dependencies: { mongodb: "6.0.0" },
    });
    write("packages/private/package.json", {
      name: "private",
      private: true,
      dependencies: { mongodb: "6.0.0" },
    });
    const base = commit();
    writeFileSync(nodePath.join(cwd, "packages/core/package.json"), "{not JSON");
    write("packages/private/package.json", {
      name: "private",
      private: true,
      dependencies: { mongodb: "7.0.0" },
    });
    const { result, generated } = generate(base, commit());
    expect(result.status, result.stderr).toBe(0);
    expect(generated).toBeNull();
  });

  it("rejects revision expressions in place of pinned commit SHAs", () => {
    const { write, commit, generate } = repository();
    write("package.json", {});
    const head = commit();
    for (const revision of ["HEAD", "--help", `${head}:package.json`, ""]) {
      const { result, generated } = generate(revision, head);
      expect(result.status).not.toBe(0);
      expect(generated).toBeNull();
    }
  });
});
