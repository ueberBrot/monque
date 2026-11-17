/* oxlint-disable eslint/no-await-in-loop -- Pack each artifact sequentially to bound filesystem and subprocess usage. */
/* oxlint-disable sonarjs/no-os-command-from-path -- Use the workspace-pinned vp and Bun toolchain. */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Pack projected Changesets versions without changing the workspace.
 * Dist files are copied, not rebuilt, so archives check compatibility, not embedded
 * version metadata or byte-equivalence. Release builds run after versioning.
 */
export const packRelease = async (root: string, names: string[], directory: string) => {
  const planPath = path.join(directory, "release-plan.json");
  execFileSync("vp", ["exec", "changeset", "status", `--output=${planPath}`], {
    cwd: root,
    stdio: "pipe",
  });

  const plan = z
    .object({
      releases: z.array(z.object({ name: z.string(), newVersion: z.string() })),
    })
    .parse(JSON.parse(await readFile(planPath, "utf-8")));

  const versions = new Map(plan.releases.map((release) => [release.name, release.newVersion]));
  const archives: Record<string, string> = {};

  for (const name of names) {
    const source = path.join(root, "packages", name);
    const stage = path.join(directory, "release", name);
    await mkdir(stage, { recursive: true });
    await cp(source, stage, {
      recursive: true,
      filter: (entry) => !["node_modules", ".vite"].includes(path.basename(entry)),
    });

    const manifest = z
      .object({
        name: z.string(),
        version: z.string(),
        dependencies: z.record(z.string(), z.string()).optional(),
        devDependencies: z.unknown().optional(),
        peerDependencies: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .parse(JSON.parse(await readFile(path.join(stage, "package.json"), "utf-8")));

    delete manifest.devDependencies;
    manifest.version = versions.get(manifest.name) ?? manifest.version;

    for (const dependencies of [manifest.dependencies, manifest.peerDependencies]) {
      for (const [dependency, range] of Object.entries(dependencies ?? {})) {
        if (range.startsWith("workspace:") && dependencies !== undefined) {
          const version =
            versions.get(dependency) ??
            (() => {
              throw new Error(`Missing release for ${dependency}`);
            })();

          dependencies[dependency] = `${range === "workspace:*" ? "" : "^"}${version}`;
        }
      }
    }

    await writeFile(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const archive = path.join(directory, `${name}.tgz`);
    execFileSync("bun", ["pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], {
      cwd: stage,
      stdio: "pipe",
    });
    archives[manifest.name] = archive;
  }

  return archives;
};
