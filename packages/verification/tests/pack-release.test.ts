import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { packRelease } from "../../../scripts/verification/pack-release.mts";

describe("release packing", () => {
  it.each([false, true])(
    "packs unchanged dependencies with a pending adapter release: %s",
    async (pending) => {
      const directory = await mkdtemp(path.join(tmpdir(), "monque-pack-release-"));
      const root = path.join(directory, "workspace");
      const output = path.join(directory, "output");

      const adapter = {
        name: "@fixture/adapter",
        version: "1.0.0",
        dependencies: { "@fixture/renderer": "workspace:^" },
        peerDependencies: { "@fixture/core": "workspace:*" },
      };

      try {
        await mkdir(path.join(root, ".changeset"), { recursive: true });
        await writeFile(path.join(root, ".changeset/README.md"), "Changesets\n");
        await mkdir(output);
        await symlink(
          path.resolve(import.meta.dirname, "../../../node_modules"),
          path.join(root, "node_modules"),
        );
        await writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }),
        );
        await writeFile(path.join(root, "bun.lock"), "{}\n");
        await writeFile(
          path.join(root, ".changeset/config.json"),
          JSON.stringify({
            baseBranch: "main",
            changelog: false,
            commit: false,
            fixed: [],
            linked: [],
            access: "public",
            updateInternalDependencies: "patch",
            ignore: [],
          }),
        );

        await Promise.all(
          Object.entries({
            adapter,
            renderer: { name: "@fixture/renderer", version: "1.2.3" },
            core: { name: "@fixture/core", version: "2.3.4" },
          }).map(async ([name, manifest]) => {
            await mkdir(path.join(root, "packages", name), { recursive: true });
            await writeFile(
              path.join(root, "packages", name, "package.json"),
              JSON.stringify(manifest),
            );
          }),
        );

        execFileSync("/usr/bin/git", ["init", "--initial-branch=main"], {
          cwd: root,
          stdio: "pipe",
        });
        execFileSync(
          "/usr/bin/git",
          ["add", "package.json", "bun.lock", "packages", ".changeset"],
          {
            cwd: root,
          },
        );
        execFileSync(
          "/usr/bin/git",
          [
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--no-verify",
            "-m",
            "Fixture",
          ],
          { cwd: root, stdio: "pipe" },
        );

        if (pending) {
          await writeFile(
            path.join(root, ".changeset/adapter.md"),
            '---\n"@fixture/adapter": patch\n---\n\nUpdate adapter.\n',
          );
        } else {
          execFileSync("/usr/bin/git", ["checkout", "-b", "release"], { cwd: root, stdio: "pipe" });
          adapter.version = "1.0.1";
          await writeFile(
            path.join(root, "packages/adapter/package.json"),
            JSON.stringify(adapter),
          );
        }

        const archives = await packRelease(root, ["adapter"], output);
        const archive = z.string().parse(archives[adapter.name]);

        const packed: unknown = JSON.parse(
          execFileSync("/usr/bin/tar", ["-xOf", archive, "package/package.json"], {
            encoding: "utf-8",
          }),
        );

        expect(packed).toMatchObject({
          version: "1.0.1",
          dependencies: { "@fixture/renderer": "^1.2.3" },
          peerDependencies: { "@fixture/core": "2.3.4" },
        });

        expect(
          JSON.parse(await readFile(path.join(root, "packages/adapter/package.json"), "utf-8")),
        ).toStrictEqual(adapter);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
