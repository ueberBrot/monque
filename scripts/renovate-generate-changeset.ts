import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { z } from "zod";

interface DependencyVersions {
  [name: string]: string;
}
interface Catalogs {
  [name: string]: DependencyVersions;
}
interface WorkspaceCatalogs {
  catalog?: DependencyVersions;
  catalogs?: Catalogs;
}
interface PackageManifest extends WorkspaceCatalogs {
  name?: string;
  private: boolean;
  dependencies: DependencyVersions;
  optionalDependencies: DependencyVersions;
  peerDependencies: DependencyVersions;
  workspaces: WorkspaceCatalogs;
}
const isJsonObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const dependencyVersionsSchema = z.unknown().transform((input): DependencyVersions => {
  const entries: [string, unknown][] = isJsonObject(input) ? Object.entries(input) : [];
  const strings = entries.filter((entry): entry is [string, string] => isString(entry[1]));
  return Object.fromEntries(strings);
});
const catalogsSchema = z.unknown().transform((input): Catalogs => {
  const entries: [string, unknown][] = isJsonObject(input) ? Object.entries(input) : [];
  return Object.fromEntries(
    entries.map(([name, catalog]) => [name, dependencyVersionsSchema.parse(catalog)]),
  );
});
const workspaceCatalogsSchema = z.unknown().transform((input): WorkspaceCatalogs => ({
  catalog:
    isJsonObject(input) &&
    "catalog" in input &&
    input.catalog !== null &&
    input.catalog !== undefined
      ? dependencyVersionsSchema.parse(input.catalog)
      : undefined,
  catalogs:
    isJsonObject(input) &&
    "catalogs" in input &&
    input.catalogs !== null &&
    input.catalogs !== undefined
      ? catalogsSchema.parse(input.catalogs)
      : undefined,
}));
const packageManifestSchema = z.unknown().transform((input): PackageManifest | null => {
  if (!isJsonObject(input)) {
    return null;
  }
  return {
    ...workspaceCatalogsSchema.parse(input),
    name: "name" in input && isString(input.name) ? input.name : undefined,
    private: "private" in input && input.private === true,
    dependencies: dependencyVersionsSchema.parse(
      "dependencies" in input ? input.dependencies : undefined,
    ),
    optionalDependencies: dependencyVersionsSchema.parse(
      "optionalDependencies" in input ? input.optionalDependencies : undefined,
    ),
    peerDependencies: dependencyVersionsSchema.parse(
      "peerDependencies" in input ? input.peerDependencies : undefined,
    ),
    workspaces: workspaceCatalogsSchema.parse("workspaces" in input ? input.workspaces : undefined),
  };
});

const git = (args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", args, { encoding: "utf-8", ...options }).trim();
const readManifestAt = (ref: string, filePath: string): PackageManifest | null => {
  try {
    return packageManifestSchema.parse(JSON.parse(git(["show", `${ref}:${filePath}`])));
  } catch {
    return null;
  }
};
const resolveVersion = (
  depName: string,
  version: string,
  rootPkg: PackageManifest | null,
): string => {
  if (!version.startsWith("catalog:") || rootPkg === null) {
    return version;
  }
  const catalogName = version.slice("catalog:".length);
  const catalog =
    catalogName.length === 0
      ? (rootPkg.catalog ?? rootPkg.workspaces.catalog)
      : (rootPkg.catalogs ?? rootPkg.workspaces.catalogs)?.[catalogName];
  return catalog?.[depName] ?? version;
};
const hasDependencyUpdates = (
  before: PackageManifest,
  after: PackageManifest,
  rootBefore: PackageManifest | null,
  rootAfter: PackageManifest | null,
): boolean => {
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const prev = before[key];
    const next = after[key];
    for (const [name, rawTo] of Object.entries(next)) {
      const rawFrom = prev[name];
      if (rawFrom === undefined) {
        continue;
      }
      if (resolveVersion(name, rawFrom, rootBefore) !== resolveVersion(name, rawTo, rootAfter)) {
        return true;
      }
    }
  }
  return false;
};

const main = async (): Promise<void> => {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  if (
    baseSha === undefined ||
    headSha === undefined ||
    ![baseSha, headSha].every((sha) => /^[0-9a-f]{40}$/u.test(sha))
  ) {
    throw new Error("BASE_SHA and HEAD_SHA must be full commit SHAs.");
  }

  const changedFiles = git(["diff", "--name-only", "-z", `${baseSha}...${headSha}`])
    .split("\0")
    .filter(Boolean);
  if (changedFiles.some((path) => path.startsWith(".changeset/") && path.endsWith(".md"))) {
    console.log("PR already contains a changeset file; nothing to do.");
    return;
  }

  const rootBefore = readManifestAt(baseSha, "package.json");
  const rootAfter = readManifestAt(headSha, "package.json");
  const packagePaths = git(["ls-tree", "-r", "--name-only", "-z", baseSha, "--", "packages"])
    .split("\0")
    .filter((path) => /^packages\/[^/]+\/package\.json$/u.test(path));
  const updatedPackages = new Set<string>();
  for (const path of packagePaths) {
    if (!changedFiles.includes("package.json") && !changedFiles.includes(path)) {
      continue;
    }
    const before = readManifestAt(baseSha, path);
    const after = readManifestAt(headSha, path);
    if (before === null || after === null || after.private) {
      continue;
    }
    if (after.name === undefined) {
      continue;
    }
    if (hasDependencyUpdates(before, after, rootBefore, rootAfter)) {
      updatedPackages.add(after.name);
    }
  }
  if (updatedPackages.size === 0) {
    console.log("No published dependency updates detected; nothing to do.");
    return;
  }

  const id = createHash("sha256").update(headSha).digest("hex").slice(0, 16);
  const path = `.changeset/renovate-deps-${id}.md`;
  const releases = [...updatedPackages].toSorted().map((name) => `${JSON.stringify(name)}: minor`);
  const content = `---\n${releases.join("\n")}\n---\n\nUpdate runtime dependencies.\n`;

  const directory = await mkdtemp(nodePath.join(tmpdir(), "monque-renovate-index-"));
  try {
    const env = {
      ...process.env,
      GIT_INDEX_FILE: nodePath.join(directory, "index"),
      GIT_AUTHOR_NAME: "github-actions[bot]",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    };
    git(["read-tree", headSha], { env });
    const blob = git(["hash-object", "-w", "--stdin"], { input: content });
    git(["update-index", "--add", "--cacheinfo", "100644", blob, path], { env });
    const tree = git(["write-tree"], { env });
    const commit = git(["commit-tree", tree, "-p", headSha], {
      env,
      input: "chore(changeset): add renovate deps changeset\n",
    });
    console.log(`Created changeset commit ${commit}`);
    if (process.env.GITHUB_OUTPUT !== undefined && process.env.GITHUB_OUTPUT.length > 0) {
      await appendFile(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

await main();
