import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";

// ============================================
// LS Tool - List Directory Contents
// ============================================

const LsSchema = Type.Object({
  path: Type.String({
    description: "Directory path to list (defaults to current directory)",
  }),
  detailed: Type.Optional(
    Type.Boolean({
      description: "Show detailed information (permissions, size, modified time)",
    }),
  ),
});

export function createLsTool(workspaceRoot: string): AnyAgentTool {
  return {
    label: "List Directory",
    name: "ls",
    description:
      "List directory contents. Use this to explore folder structure before reading files.",
    parameters: LsSchema,
    execute: async (_toolCallId, params) => {
      const dirPath = readStringParam(params, "path", { required: false }) || ".";
      const detailed = Boolean(params.detailed);

      // Resolve path relative to workspace root
      const resolvedPath = path.isAbsolute(dirPath)
        ? dirPath
        : path.resolve(workspaceRoot, dirPath);

      // Security: ensure path is within workspace root
      const normalizedResolved = path.resolve(resolvedPath);
      const normalizedRoot = path.resolve(workspaceRoot);
      if (!normalizedResolved.startsWith(normalizedRoot)) {
        throw new ToolInputError(`Path escapes workspace root: ${dirPath}`);
      }

      try {
        const entries = await fs.readdir(normalizedResolved, { withFileTypes: true });

        if (detailed) {
          const results = await Promise.all(
            entries.map(async (entry) => {
              const fullPath = path.join(normalizedResolved, entry.name);
              const stat = await fs.stat(fullPath);
              return {
                name: entry.name,
                type: entry.isDirectory()
                  ? "directory"
                  : entry.isSymbolicLink()
                    ? "symlink"
                    : "file",
                size: stat.size,
                modifiedAt: stat.mtime.toISOString(),
                permissions: stat.mode.toString(8).slice(-3),
              };
            }),
          );
          return jsonResult({
            path: normalizedResolved,
            entries: results,
            total: results.length,
          });
        } else {
          const simple = entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
          }));
          return jsonResult({
            path: normalizedResolved,
            entries: simple,
            total: simple.length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolInputError(`Failed to list directory: ${message}`);
      }
    },
  };
}

// ============================================
// Find Tool - Find Files by Pattern
// ============================================

const FindSchema = Type.Object({
  pattern: Type.String({
    description: "Glob pattern to match (e.g., '*.ts', '**/*.md')",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory to search in (defaults to workspace root)",
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (default: 100)",
    }),
  ),
});

async function globSearch(dir: string, pattern: string, maxResults: number): Promise<string[]> {
  const results: string[] = [];
  const patternParts = pattern.split("/");
  const currentPattern = patternParts[0];
  const remainingPattern = patternParts.slice(1).join("/");

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxResults) {
      break;
    }

    const fullPath = path.join(dir, entry.name);

    // Skip hidden files and node_modules unless explicitly requested
    if (entry.name.startsWith(".") && !currentPattern.startsWith(".")) {
      continue;
    }
    if (entry.name === "node_modules" && !pattern.includes("node_modules")) {
      continue;
    }

    if (entry.isDirectory()) {
      // If pattern starts with **, search recursively
      if (currentPattern === "**") {
        const subResults = await globSearch(fullPath, pattern, maxResults - results.length);
        results.push(...subResults);
      }
      // If current pattern matches or is *, recurse
      if (currentPattern === "*" || matchesPattern(entry.name, currentPattern)) {
        if (remainingPattern) {
          const subResults = await globSearch(
            fullPath,
            remainingPattern,
            maxResults - results.length,
          );
          results.push(...subResults);
        }
      }
    } else if (entry.isFile()) {
      if (currentPattern === "*" || matchesPattern(entry.name, currentPattern)) {
        if (!remainingPattern) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}

function matchesPattern(name: string, pattern: string): boolean {
  // Simple glob pattern matching
  const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(name);
}

export function createFindTool(workspaceRoot: string): AnyAgentTool {
  return {
    label: "Find Files",
    name: "find",
    description:
      "Find files by glob pattern. Examples: '*.ts' for TypeScript files, '**/*.md' for all Markdown files recursively.",
    parameters: FindSchema,
    execute: async (_toolCallId, params) => {
      const pattern = readStringParam(params, "pattern", { required: true });
      const searchPath = readStringParam(params, "path", { required: false }) || ".";
      const maxResults = Number(params.maxResults) || 100;

      // Resolve path relative to workspace root
      const resolvedPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(workspaceRoot, searchPath);

      // Security: ensure path is within workspace root
      const normalizedResolved = path.resolve(resolvedPath);
      const normalizedRoot = path.resolve(workspaceRoot);
      if (!normalizedResolved.startsWith(normalizedRoot)) {
        throw new ToolInputError(`Path escapes workspace root: ${searchPath}`);
      }

      try {
        const results = await globSearch(normalizedResolved, pattern, maxResults);

        // Make paths relative to workspace root for cleaner output
        const relativeResults = results.map((r) => {
          const rel = path.relative(normalizedRoot, r);
          return rel.startsWith("..") ? r : rel;
        });

        return jsonResult({
          pattern,
          path: normalizedResolved,
          files: relativeResults,
          total: relativeResults.length,
          truncated: relativeResults.length >= maxResults,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolInputError(`Failed to find files: ${message}`);
      }
    },
  };
}

// ============================================
// Grep Tool - Search File Contents
// ============================================

const GrepSchema = Type.Object({
  pattern: Type.String({
    description: "Regular expression pattern to search for",
  }),
  path: Type.Optional(
    Type.String({
      description: "File or directory to search in (defaults to workspace root)",
    }),
  ),
  include: Type.Optional(
    Type.String({
      description: "Glob pattern for files to include (e.g., '*.ts')",
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum number of matching lines to return (default: 50)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of context lines to show before and after each match (default: 0)",
    }),
  ),
});

async function grepFile(
  filePath: string,
  pattern: RegExp,
  context: number,
): Promise<
  Array<{ line: number; content: string; contextBefore: string[]; contextAfter: string[] }>
> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const matches: Array<{
    line: number;
    content: string;
    contextBefore: string[];
    contextAfter: string[];
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      const contextBefore = lines.slice(Math.max(0, i - context), i);
      const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + context + 1));
      matches.push({
        line: i + 1,
        content: lines[i],
        contextBefore,
        contextAfter,
      });
    }
  }

  return matches;
}

export function createGrepTool(workspaceRoot: string): AnyAgentTool {
  return {
    label: "Grep",
    name: "grep",
    description:
      "Search file contents using regular expressions. Use to find specific code, text, or patterns across files.",
    parameters: GrepSchema,
    execute: async (_toolCallId, params) => {
      const patternStr = readStringParam(params, "pattern", { required: true });
      const searchPath = readStringParam(params, "path", { required: false }) || ".";
      const include = readStringParam(params, "include", { required: false });
      const maxResults = Number(params.maxResults) || 50;
      const context = Number(params.context) || 0;

      // Compile regex
      let pattern: RegExp;
      try {
        pattern = new RegExp(patternStr, "i");
      } catch {
        throw new ToolInputError(`Invalid regular expression: ${patternStr}`);
      }

      // Resolve path relative to workspace root
      const resolvedPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(workspaceRoot, searchPath);

      // Security: ensure path is within workspace root
      const normalizedResolved = path.resolve(resolvedPath);
      const normalizedRoot = path.resolve(workspaceRoot);
      if (!normalizedResolved.startsWith(normalizedRoot)) {
        throw new ToolInputError(`Path escapes workspace root: ${searchPath}`);
      }

      try {
        const stat = await fs.stat(normalizedResolved);
        let filesToSearch: string[] = [];

        if (stat.isFile()) {
          filesToSearch = [normalizedResolved];
        } else if (stat.isDirectory()) {
          // Recursively find all files, respecting include pattern
          const searchPattern = include || "**/*";
          const allFiles = await globSearch(normalizedResolved, searchPattern, 10000);
          filesToSearch = allFiles.filter((f) => {
            const base = path.basename(f);
            return !base.startsWith("."); // Skip hidden files
          });
        }

        const results: Array<{
          file: string;
          line: number;
          content: string;
          contextBefore?: string[];
          contextAfter?: string[];
        }> = [];

        for (const file of filesToSearch) {
          if (results.length >= maxResults) {
            break;
          }

          try {
            const matches = await grepFile(file, pattern, context);
            for (const match of matches) {
              if (results.length >= maxResults) {
                break;
              }

              const relFile = path.relative(normalizedRoot, file);
              results.push({
                file: relFile.startsWith("..") ? file : relFile,
                line: match.line,
                content: match.content,
                ...(context > 0 && {
                  contextBefore: match.contextBefore,
                  contextAfter: match.contextAfter,
                }),
              });
            }
          } catch {
            // Skip binary files or files that can't be read
            continue;
          }
        }

        return jsonResult({
          pattern: patternStr,
          path: normalizedResolved,
          matches: results,
          total: results.length,
          truncated: results.length >= maxResults,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolInputError(`Failed to grep: ${message}`);
      }
    },
  };
}
