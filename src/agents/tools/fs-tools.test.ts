import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLsTool, createFindTool, createGrepTool } from "./fs-tools.js";

describe("fs-tools", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-fs-tools-test-"));
    // Create test structure
    await fs.mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "Hello World");
    await fs.writeFile(path.join(tmpDir, "file2.ts"), "export const test = 1;");
    await fs.writeFile(path.join(tmpDir, "subdir", "file3.txt"), "Nested file");
    await fs.writeFile(path.join(tmpDir, "subdir", "file4.test.ts"), "describe('test', () => {});");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("createLsTool", () => {
    it("lists directory contents", async () => {
      const tool = createLsTool(tmpDir);
      const result = await tool.execute("test-1", { path: "." });

      expect(result.content).toBeDefined();
      const text = result.content.find((b) => b.type === "text");
      expect(text).toBeDefined();

      const data = JSON.parse(text.text);
      expect(data.entries).toHaveLength(3); // file1.txt, file2.ts, subdir
      expect(data.entries.map((e) => e.name)).toContain("file1.txt");
      expect(data.entries.map((e) => e.name)).toContain("subdir");
    });

    it("shows detailed information", async () => {
      const tool = createLsTool(tmpDir);
      const result = await tool.execute("test-2", { path: ".", detailed: true });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      const fileEntry = data.entries.find((e) => e.name === "file1.txt");
      expect(fileEntry).toBeDefined();
      expect(fileEntry.type).toBe("file");
      expect(fileEntry.size).toBeGreaterThan(0);
      expect(fileEntry.modifiedAt).toBeDefined();
    });

    it("rejects paths outside workspace", async () => {
      const tool = createLsTool(tmpDir);
      await expect(tool.execute("test-3", { path: "/etc" })).rejects.toThrow(
        "escapes workspace root",
      );
    });
  });

  describe("createFindTool", () => {
    it("finds files by pattern", async () => {
      const tool = createFindTool(tmpDir);
      const result = await tool.execute("test-4", { pattern: "*.txt" });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toContain("file1.txt");
    });

    it("finds files recursively with **", async () => {
      const tool = createFindTool(tmpDir);
      const result = await tool.execute("test-5", { pattern: "**/*.test.ts" });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toContain("file4.test.ts");
    });

    it("respects maxResults", async () => {
      const tool = createFindTool(tmpDir);
      const result = await tool.execute("test-6", { pattern: "*", maxResults: 2 });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      expect(data.files.length).toBeLessThanOrEqual(2);
    });
  });

  describe("createGrepTool", () => {
    it("searches file contents", async () => {
      const tool = createGrepTool(tmpDir);
      const result = await tool.execute("test-7", { pattern: "Hello", include: "*.txt" });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      expect(data.matches.length).toBeGreaterThan(0);
      expect(data.matches[0].content).toContain("Hello");
      expect(data.matches[0].file).toContain("file1.txt");
    });

    it("searches with regex", async () => {
      const tool = createGrepTool(tmpDir);
      const result = await tool.execute("test-8", { pattern: "export\\s+const", include: "*.ts" });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      expect(data.matches.length).toBeGreaterThan(0);
      expect(data.matches[0].file).toContain("file2.ts");
    });

    it("includes context lines", async () => {
      const tool = createGrepTool(tmpDir);
      const result = await tool.execute("test-9", { pattern: "test", context: 1 });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      if (data.matches.length > 0) {
        expect(data.matches[0]).toHaveProperty("contextBefore");
        expect(data.matches[0]).toHaveProperty("contextAfter");
      }
    });

    it("filters by include pattern", async () => {
      const tool = createGrepTool(tmpDir);
      const result = await tool.execute("test-10", { pattern: "test", include: "*.ts" });

      const text = result.content.find((b) => b.type === "text");
      const data = JSON.parse(text.text);

      // Should only find matches in .ts files, not .txt files
      data.matches.forEach((match) => {
        expect(match.file).toMatch(/\.ts$/);
      });
    });
  });
});
