#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

/**
 * API Link Validator
 *
 * This script scans MDX/MD files in the docs folder for links to `/monque/api/` paths
 * and verifies they resolve to existing API documentation files.
 *
 * Usage:
 *   vp run lint:api-links
 *
 * Exit codes:
 *   0 - All links valid
 *   1 - Invalid links found
 *
 * For CI, add to your workflow:
 *   - name: Validate API links
 *     run: vp run lint:api-links
 */

interface ApiLink {
  fullLink: string;
  path: string;
  anchor: string;
  line: number;
  column: number;
  file: string;
}

interface InvalidLink extends ApiLink {
  reason: string;
}

const rootDir = path.resolve(import.meta.dirname, "..");
const docsDir = path.join(rootDir, "apps/docs/src/content/docs");

/**
 * Recursively find all files matching extensions in a directory.
 */
const findFiles = (dir: string, extensions: string[], ignore: string[] = []): string[] => {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(docsDir, fullPath);

    // Check if this path should be ignored
    if (ignore.some((pattern) => relativePath.startsWith(pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extensions, ignore));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
};

/**
 * Build a map of valid API paths from the generated API docs.
 * Supports paths like:
 *   /monque/api/classes/monque/
 *   /monque/api/interfaces/job/
 *   /monque/api/classes/monque/#enqueue (with anchors)
 */
const buildApiPathMap = (): Set<string> => {
  const apiDir = path.join(docsDir, "api");
  const validPaths = new Set<string>();

  // Find all .md files in the API directory
  const apiFiles = findFiles(apiDir, [".md"]);

  for (const file of apiFiles) {
    // Convert file path to URL path
    // e.g., "classes/Monque.md" -> "/monque/api/classes/monque/"
    const relativePath = path.relative(apiDir, file).replace(/\.md$/u, "").toLowerCase();
    const urlPath = `/monque/api/${relativePath}/`;

    validPaths.add(urlPath);

    // Also add without trailing slash
    validPaths.add(urlPath.slice(0, -1));
  }

  return validPaths;
};

/**
 * Extract all /monque/api/ links from a markdown/MDX file.
 * Returns array of { link, line, column } objects.
 */
const extractApiLinks = (content: string, filePath: string): ApiLink[] => {
  const links: ApiLink[] = [];

  // Match markdown links: [text](/monque/api/...)
  // and bare URLs in href attributes or similar
  const linkRegex = /\[(?<text>[^\]]*)\]\((?<path>\/monque\/api\/[^)#\s]+)(?<anchor>#[^)\s]*)?\)/gu;
  const lines = content.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum += 1) {
    const line = lines[lineNum];
    const matches = line.matchAll(linkRegex);

    for (const match of matches) {
      const { path: fullPath, anchor = "" } = match.groups ?? {};
      if (fullPath === undefined) {
        continue;
      }

      links.push({
        fullLink: match[0],
        path: fullPath,
        anchor,
        line: lineNum + 1,
        column: match.index + 1,
        file: filePath,
      });
    }
  }

  return links;
};

/**
 * Check if an anchor exists in the target API file.
 * Anchors in typedoc-generated markdown use format like:
 *   ### enqueue()  ->  #enqueue
 *   ### getJob()   ->  #getjob
 */
const validateAnchor = (apiPath: string, anchor: string): boolean => {
  if (!anchor) {
    return true;
  }

  // Convert URL path back to file path
  // /monque/api/classes/monque/ -> api/classes/Monque.md
  const relativePath = apiPath.replace("/monque/api/", "").replace(/\/$/u, "");

  // Find the actual file (case-insensitive match)
  const apiDir = path.join(docsDir, "api");
  const possiblePaths = findFiles(apiDir, [".md"]);

  const matchingFile = possiblePaths.find(
    (p) =>
      path.relative(apiDir, p).toLowerCase().replace(/\.md$/u, "") === relativePath.toLowerCase(),
  );

  if (matchingFile === undefined) {
    return false;
  }

  const content = fs.readFileSync(matchingFile, "utf-8");

  // Look for heading that would create this anchor
  // Typedoc generates: ### methodName() which becomes #methodname
  const anchorName = anchor.replace("#", "").toLowerCase();

  // Match headings like: ### methodName() or ## PropertyName
  const headingRegex = /^#{1,6}\s+(?<heading>[^\n]+)/gmu;
  const matches = content.matchAll(headingRegex);

  for (const match of matches) {
    const [, headingText] = match;
    // Generate anchor from heading (simplified - matches common patterns)
    const generatedAnchor = headingText
      .toLowerCase()
      .replaceAll(/[()[\]]/gu, "")
      .replaceAll(/\s+/gu, "-")
      .replaceAll(/[^a-z0-9-]/gu, "")
      .replaceAll(/-+/gu, "-")
      .replaceAll(/^-|-$/gu, "");

    if (generatedAnchor === anchorName || headingText.toLowerCase().includes(anchorName)) {
      return true;
    }
  }

  return false;
};

/**
 * Main validation logic
 */
const main = (): void => {
  console.log("🔍 Validating API links in documentation...\n");

  const validPaths = buildApiPathMap();
  console.log(`📚 Found ${validPaths.size} valid API paths\n`);

  // Find all MDX and MD files in docs (excluding API folder itself)
  const docFiles = findFiles(docsDir, [".mdx", ".md"], ["api"]);

  let totalLinks = 0;
  const invalidLinks: InvalidLink[] = [];

  for (const file of docFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const relativeFile = path.relative(docsDir, file);
    const links = extractApiLinks(content, relativeFile);

    for (const link of links) {
      totalLinks += 1;

      // Normalize path (ensure trailing slash for comparison)
      let normalizedPath = link.path.toLowerCase();
      if (!normalizedPath.endsWith("/")) {
        normalizedPath += "/";
      }

      // Check if base path exists
      const pathExists =
        validPaths.has(normalizedPath) || validPaths.has(normalizedPath.slice(0, -1));

      if (!pathExists) {
        invalidLinks.push({
          ...link,
          reason: `Path not found: ${link.path}`,
        });
        continue;
      }

      // If there's an anchor, validate it
      if (link.anchor) {
        const anchorValid = validateAnchor(link.path, link.anchor);
        if (!anchorValid) {
          invalidLinks.push({
            ...link,
            reason: `Anchor not found: ${link.anchor}`,
          });
        }
      }
    }
  }

  // Report results
  console.log(`📊 Scanned ${docFiles.length} documentation files`);
  console.log(`🔗 Found ${totalLinks} API links\n`);

  if (invalidLinks.length === 0) {
    console.log("✅ All API links are valid!\n");
    process.exit(0);
  }

  console.log(`❌ Found ${invalidLinks.length} invalid links:\n`);

  // Group by file for cleaner output
  const byFile: Record<string, InvalidLink[]> = {};
  for (const link of invalidLinks) {
    (byFile[link.file] ??= []).push(link);
  }

  for (const [file, links] of Object.entries(byFile)) {
    console.log(`  📄 ${file}`);
    for (const link of links) {
      console.log(`     Line ${link.line}: ${link.reason}`);
      console.log(`       ${link.fullLink}`);
    }
    console.log();
  }

  process.exit(1);
};

main();
