import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveArtifactContent } from "../harness/route/artifact-content.js";

// Wraps the real `node:fs` so `readFileSync` calls can be counted without
// changing its behavior — a spy on the namespace object doesn't work here
// (Node's ESM module namespace isn't configurable), so this mocks the whole
// module through to the actual implementation instead.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const readFileSyncSpy = vi.mocked(readFileSync);

/**
 * Unit coverage for `resolveArtifactContent`'s pure resolution
 * logic, independent of the HTTP route (see `test/bff-artifact-content-route.test.ts`
 * for the wired-through-`createApp` coverage). Focuses on the two load-bearing
 * security properties: containment is checked via `path.relative()` (never
 * `startsWith`, which a sibling directory sharing the root as a string prefix
 * would defeat) and a location outside the artifacts root is refused before
 * any file *content* read occurs — not merely refused with an error.
 */
describe("resolveArtifactContent", () => {
  let root: string;

  beforeEach(() => {
    readFileSyncSpy.mockClear();
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function freshRoot(): string {
    root = mkdtempSync(path.join(tmpdir(), "wren-harness-artifact-content-"));
    return root;
  }

  it("reads back a Mode B envelope byte-for-byte (well-formed 'blocks' JSON -> form: 'envelope')", () => {
    const dir = freshRoot();
    const envelope = { blocks: [{ type: "kpi_card", label: "Revenue", value: 42000 }], summary: "ok", verified: true };
    const location = path.join(dir, "session-1", "dashboard-turn-1.json");
    mkdirSync(path.dirname(location), { recursive: true });
    writeFileSync(location, JSON.stringify(envelope), "utf-8");

    expect(resolveArtifactContent(dir, location)).toEqual({ form: "envelope", envelope });
  });

  it("resolves a relative location against the artifacts root (Mode A's write_artifact convention)", () => {
    const dir = freshRoot();
    writeFileSync(path.join(dir, "notes.md"), "# hello\n", "utf-8");

    expect(resolveArtifactContent(dir, "notes.md")).toEqual({ form: "text", text: "# hello\n", truncated: false });
  });

  it("JSON that isn't envelope-shaped (no 'blocks' array) degrades to form: 'text', not a fabricated envelope", () => {
    const dir = freshRoot();
    const location = path.join(dir, "plain.json");
    writeFileSync(location, JSON.stringify({ hello: "world" }), "utf-8");

    expect(resolveArtifactContent(dir, location)).toEqual({
      form: "text",
      text: JSON.stringify({ hello: "world" }),
      truncated: false,
    });
  });

  it("a missing file is 'unavailable: missing'", () => {
    const dir = freshRoot();
    expect(resolveArtifactContent(dir, path.join(dir, "nope.json"))).toEqual({ form: "unavailable", reason: "missing" });
  });

  it("a file over the read-size cap is 'unavailable: too_large', refused before it is read", () => {
    const dir = freshRoot();
    const location = path.join(dir, "huge.json");
    // Just over the 2 MiB cap.
    writeFileSync(location, "x".repeat(2 * 1024 * 1024 + 1), "utf-8");

    expect(resolveArtifactContent(dir, location)).toEqual({ form: "unavailable", reason: "too_large" });
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("a `../` traversal outside the root is refused as 'outside_root' with zero file reads", () => {
    const dir = freshRoot();
    // A real file that genuinely exists just outside the root, so a naive
    // "does it exist" check alone would not catch this.
    const outside = path.join(dir, "..", `escape-${path.basename(dir)}.json`);
    writeFileSync(outside, JSON.stringify({ blocks: [] }), "utf-8");
    try {
      expect(resolveArtifactContent(dir, path.join("..", path.basename(outside)))).toEqual({
        form: "unavailable",
        reason: "outside_root",
      });
      expect(readFileSyncSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("a sibling directory that merely shares the root as a string prefix is refused (startsWith would wrongly allow it)", () => {
    const dir = freshRoot();
    const evilSibling = `${dir}-evil`;
    mkdirSync(evilSibling, { recursive: true });
    const outsideFile = path.join(evilSibling, "secret.json");
    writeFileSync(outsideFile, JSON.stringify({ blocks: [] }), "utf-8");
    try {
      // An absolute location pointing at the sibling dir — `outsideFile.startsWith(dir)`
      // is true (bad) but `path.relative(dir, outsideFile)` correctly starts with "..".
      expect(resolveArtifactContent(dir, outsideFile)).toEqual({ form: "unavailable", reason: "outside_root" });
      expect(readFileSyncSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(evilSibling, { recursive: true, force: true });
    }
  });

  it("a symlink inside the root that points outside it is refused as 'outside_root', with zero content reads", () => {
    const dir = freshRoot();
    const outsideDir = mkdtempSync(path.join(tmpdir(), "wren-harness-artifact-content-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.json");
      writeFileSync(outsideFile, JSON.stringify({ blocks: [] }), "utf-8");
      const linkPath = path.join(dir, "escape-link.json");
      symlinkSync(outsideFile, linkPath);

      // The nominal path IS inside the root (only the symlink *target* escapes),
      // so this exercises the second (post-realpath) containment check.
      expect(resolveArtifactContent(dir, linkPath)).toEqual({ form: "unavailable", reason: "outside_root" });
      expect(readFileSyncSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("does not mutate the file it reads (sanity: content on disk is unchanged after resolution)", () => {
    const dir = freshRoot();
    const envelope = { blocks: [{ type: "table", columns: ["a"], rows: [] }] };
    const location = path.join(dir, "chart-1.json");
    writeFileSync(location, JSON.stringify(envelope), "utf-8");

    resolveArtifactContent(dir, location);

    expect(JSON.parse(readFileSync(location, "utf-8"))).toEqual(envelope);
  });
});
