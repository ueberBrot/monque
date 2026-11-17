/* oxlint-disable eslint/no-await-in-loop -- Pack each artifact sequentially to bound filesystem and subprocess usage. */
/* oxlint-disable sonarjs/no-os-command-from-path -- Use the workspace-pinned vp and Bun toolchain. */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const manifestFile = "package.json";

const isChangesetFile = (entry: string) => {
  const file = path.basename(entry);

  return (
    file.endsWith(".md") &&
    !file.startsWith(".") &&
    !/^(?:README|AGENTS|CLAUDE|GEMINI)\.md$/iu.test(file)
  );
};

const readReleasePlan = async (root: string, directory: string) => {
  const planPath = path.join(directory, "release-plan.json");
  const changesets = await readdir(path.join(root, ".changeset"), { recursive: true });

  const hasChangesets = changesets.some(isChangesetFile);

  // Changesets status rejects a version-only release branch after consuming its changesets.
  if (hasChangesets) {
    execFileSync("vp", ["exec", "changeset", "status", `--output=${planPath}`], {
      cwd: root,
      stdio: "pipe",
    });
  }

  return z
    .object({
      releases: z.array(z.object({ name: z.string(), newVersion: z.string() })),
    })
    .parse(hasChangesets ? JSON.parse(await readFile(planPath, "utf-8")) : { releases: [] });
};

/**
 * Pack projected Changesets versions without changing the workspace.
 * Dist files are copied, not rebuilt, so archives check compatibility, not embedded
 * version metadata or byte-equivalence. Release builds run after versioning.
 */
export const packRelease = async (root: string, names: string[], directory: string) => {
  const plan = await readReleasePlan(root, directory);
  const versions = new Map<string, string>();
  const packages = path.join(root, "packages");

  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifest = z
      .object({ name: z.string(), version: z.string() })
      .parse(JSON.parse(await readFile(path.join(packages, entry.name, manifestFile), "utf-8")));

    versions.set(manifest.name, manifest.version);
  }

  for (const release of plan.releases) {
    versions.set(release.name, release.newVersion);
  }

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
      .parse(JSON.parse(await readFile(path.join(stage, manifestFile), "utf-8")));

    delete manifest.devDependencies;
    manifest.version = versions.get(manifest.name) ?? manifest.version;

    for (const dependencies of [manifest.dependencies, manifest.peerDependencies]) {
      for (const [dependency, range] of Object.entries(dependencies ?? {})) {
        if (range.startsWith("workspace:") && dependencies !== undefined) {
          const version =
            versions.get(dependency) ??
            (() => {
              throw new Error(`Unknown workspace dependency ${dependency}`);
            })();

          dependencies[dependency] = `${range === "workspace:*" ? "" : "^"}${version}`;
        }
      }
    }

    await writeFile(path.join(stage, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
    const archive = path.join(directory, `${name}.tgz`);
    execFileSync("bun", ["pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], {
      cwd: stage,
      stdio: "pipe",
    });
    archives[manifest.name] = archive;
  }

  return archives;
};
