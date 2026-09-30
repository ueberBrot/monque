import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync("git", args, { encoding: "utf8", ...options }).trim();
}

function readJsonAt(ref: string, filePath: string): unknown {
  try {
    return JSON.parse(git(["show", `${ref}:${filePath}`]));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveVersion(depName: string, version: string, rootPkg: unknown): string {
  if (!version.startsWith("catalog:") || !isRecord(rootPkg)) return version;
  const workspaces = isRecord(rootPkg.workspaces) ? rootPkg.workspaces : {};
  const catalogName = version.slice("catalog:".length);
  const catalogs = rootPkg.catalogs ?? workspaces.catalogs;
  const catalog = catalogName
    ? isRecord(catalogs)
      ? catalogs[catalogName]
      : undefined
    : (rootPkg.catalog ?? workspaces.catalog);
  return isRecord(catalog) && typeof catalog[depName] === "string" ? catalog[depName] : version;
}

async function main(): Promise<void> {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  if (!baseSha || !headSha || ![baseSha, headSha].every((sha) => /^[0-9a-f]{40}$/.test(sha))) {
    throw new Error("BASE_SHA and HEAD_SHA must be full commit SHAs.");
  }

  const changedFiles = git(["diff", "--name-only", "-z", `${baseSha}...${headSha}`])
    .split("\0")
    .filter(Boolean);
  if (changedFiles.some((path) => path.startsWith(".changeset/") && path.endsWith(".md"))) {
    console.log("PR already contains a changeset file; nothing to do.");
    return;
  }

  const rootBefore = readJsonAt(baseSha, "package.json");
  const rootAfter = readJsonAt(headSha, "package.json");
  const packagePaths = git(["ls-tree", "-r", "--name-only", "-z", baseSha, "--", "packages"])
    .split("\0")
    .filter((path) => /^packages\/[^/]+\/package\.json$/.test(path));
  const changesets = new Map<string, string>();
  for (const path of packagePaths) {
    if (!changedFiles.includes("package.json") && !changedFiles.includes(path)) continue;
    const before = readJsonAt(baseSha, path);
    const after = readJsonAt(headSha, path);
    if (!isRecord(before) || !isRecord(after) || after.private === true) continue;
    if (typeof after.name !== "string") continue;
    for (const { name, from, to } of dependencyUpdates(before, after, rootBefore, rootAfter)) {
      const id = createHash("sha256")
        .update(JSON.stringify([after.name, name, from, to]))
        .digest("hex")
        .slice(0, 16);
      changesets.set(
        `.changeset/renovate-deps-${id}.md`,
        `---\n${JSON.stringify(after.name)}: minor\n---\n\nUpdate ${name} from ${from} to ${to}.\n`,
      );
    }
  }
  if (changesets.size === 0) {
    console.log("No published dependency updates detected; nothing to do.");
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), "monque-renovate-index-"));
  try {
    const env = {
      ...process.env,
      GIT_INDEX_FILE: join(directory, "index"),
      GIT_AUTHOR_NAME: "github-actions[bot]",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    };
    git(["read-tree", headSha], { env });
    for (const [path, content] of changesets) {
      const blob = git(["hash-object", "-w", "--stdin"], { input: content });
      git(["update-index", "--add", "--cacheinfo", "100644", blob, path], { env });
    }
    const tree = git(["write-tree"], { env });
    const commit = git(["commit-tree", tree, "-p", headSha], {
      env,
      input: "chore(changeset): add renovate deps changeset\n",
    });
    console.log(`Created changeset commit ${commit}`);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function dependencyUpdates(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  rootBefore: unknown,
  rootAfter: unknown,
): Array<{ name: string; from: string; to: string }> {
  const updates = new Map<string, { name: string; from: string; to: string }>();
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const prev = before[key];
    const next = after[key];
    if (!isRecord(prev) || !isRecord(next)) continue;
    for (const [name, rawTo] of Object.entries(next)) {
      const rawFrom = prev[name];
      if (typeof rawFrom !== "string" || typeof rawTo !== "string") continue;
      const from = resolveVersion(name, rawFrom, rootBefore);
      const to = resolveVersion(name, rawTo, rootAfter);
      if (from !== to) updates.set(name, { name, from, to });
    }
  }
  return [...updates.values()];
}

await main();
