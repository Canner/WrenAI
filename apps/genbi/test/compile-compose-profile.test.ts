import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPreparedBindingKind,
  composeUserProfile,
  extractBindingDocumentPath,
  extractContextBindingPath,
  rewriteContextBindingProject,
} from "../harness/compile/compose-profile.js";
import { ContextLoaderFailedError, InvalidProfileShapeError } from "../harness/compile/errors.js";
import { PathTraversalError } from "../harness/exec/index.js";

describe("extractContextBindingPath", () => {
  it("reads the context: project: pointer out of a profile.yml body", () => {
    const profileYaml = ["profile: genbi-default", "", "context:", "  project: ./context/binding.yml", ""].join("\n");
    expect(extractContextBindingPath(profileYaml, "profile.yml")).toBe("./context/binding.yml");
  });

  it("strips surrounding quotes from a quoted pointer value", () => {
    const doubleQuoted = ["context:", '  project: "./context/binding.yml"', ""].join("\n");
    expect(extractContextBindingPath(doubleQuoted, "profile.yml")).toBe("./context/binding.yml");
    const singleQuoted = ["context:", "  project: './context/binding.yml'", ""].join("\n");
    expect(extractContextBindingPath(singleQuoted, "profile.yml")).toBe("./context/binding.yml");
  });

  it("throws InvalidProfileShapeError when there's no context: project: block", () => {
    expect(() => extractContextBindingPath("profile: demo\n", "profile.yml")).toThrow(InvalidProfileShapeError);
  });

  it("throws InvalidProfileShapeError on more than one context: project: block (ambiguous)", () => {
    const twoBlocks = [
      "context:",
      "  project: ./a/binding.yml",
      "context:",
      "  project: ./b/binding.yml",
      "",
    ].join("\n");
    expect(() => extractContextBindingPath(twoBlocks, "profile.yml")).toThrow(/expected exactly one/);
  });
});

describe("rewriteContextBindingProject", () => {
  it("replaces the project: line while preserving comments above it", () => {
    const bindingYaml = ["# a comment explaining the binding", "project: ../examples/jaffle-wren", ""].join("\n");
    const rewritten = rewriteContextBindingProject(bindingYaml, "/abs/path/to/user-project", "binding.yml");
    expect(rewritten).toContain("# a comment explaining the binding");
    expect(rewritten).toContain("project: /abs/path/to/user-project");
    expect(rewritten).not.toContain("../examples/jaffle-wren");
  });

  it("does not misinterpret a `$` in the new project path as a replacement token", () => {
    const bindingYaml = "project: ./old\n";
    const rewritten = rewriteContextBindingProject(bindingYaml, "/abs/$weird/user-project", "binding.yml");
    expect(rewritten).toContain("project: /abs/$weird/user-project");
  });

  it("throws InvalidProfileShapeError when there's no project: field", () => {
    expect(() => rewriteContextBindingProject("not_a_project: foo\n", "/abs/path", "binding.yml")).toThrow(
      InvalidProfileShapeError,
    );
  });

  it("throws InvalidProfileShapeError on a duplicate top-level project: field (would silently misbind)", () => {
    const duplicate = ["project: ./first", "project: ./second", ""].join("\n");
    expect(() => rewriteContextBindingProject(duplicate, "/abs/path", "binding.yml")).toThrow(/expected exactly one/);
  });
});

describe("assertPreparedBindingKind", () => {
  it("accepts exactly one top-level kind: prepared", () => {
    expect(() => assertPreparedBindingKind("kind: prepared\nproject: ./p\n", "binding.yml")).not.toThrow();
  });

  it("rejects a binding with no kind: at all — the silent wren_project default", () => {
    // The whole point: omitting `kind:` selects Warble's built-in MDL adapter, which compiles fine
    // while ignoring the generated document. Warble emits neither `kind` nor `document` into the
    // IR, so this is the only place that divergence is observable.
    expect(() => assertPreparedBindingKind("project: ./p\n", "binding.yml")).toThrow(/declares no top-level "kind:"/);
  });

  it("rejects a non-prepared kind", () => {
    expect(() => assertPreparedBindingKind("kind: wren_project\nproject: ./p\n", "binding.yml")).toThrow(
      /declares "kind: wren_project"/,
    );
    expect(() => assertPreparedBindingKind("kind: raw_source\nproject: raw\n", "binding.yml")).toThrow(
      InvalidProfileShapeError,
    );
  });

  it("rejects a duplicate top-level kind: (ambiguous under last-key-wins parsing)", () => {
    expect(() => assertPreparedBindingKind("kind: prepared\nkind: wren_project\n", "binding.yml")).toThrow(
      /expected exactly one/,
    );
  });
});

describe("extractBindingDocumentPath", () => {
  it("reads the single top-level document: field", () => {
    expect(extractBindingDocumentPath("kind: prepared\ndocument: context/context.json\n", "binding.yml")).toBe(
      "context/context.json",
    );
  });

  it("strips surrounding quotes", () => {
    expect(extractBindingDocumentPath('document: "context/context.json"\n', "binding.yml")).toBe("context/context.json");
  });

  it("throws when a prepared binding names no document", () => {
    expect(() => extractBindingDocumentPath("kind: prepared\nproject: ./p\n", "binding.yml")).toThrow(
      /no top-level "document:" field/,
    );
  });

  it("throws on a duplicate document: field", () => {
    expect(() => extractBindingDocumentPath("document: a.json\ndocument: b.json\n", "binding.yml")).toThrow(
      /expected exactly one/,
    );
  });
});

describe("composeUserProfile", () => {
  /**
   * A stand-in for the `wren-context-loader` binary: a shell script honouring the real generator's
   * `<project-dir> -o <out.json>` contract. Using a stub rather than the real Rust build keeps this
   * suite a unit test of the composition step, and keeps it runnable on a fresh clone where nothing
   * has been `cargo build`-ed. The real generator is exercised by `compile-pipeline.test.ts`.
   */
  async function makeContextLoaderStub(body?: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-loader-stub-"));
    const bin = path.join(dir, "wren-context-loader");
    const script = body ?? `printf '{"context_version":1,"parseable":true,"project":"%s"}' "$1" > "$3"\n`;
    await writeFile(bin, `#!/bin/sh\n${script}`, { mode: 0o755 });
    return bin;
  }

  /** Builds a minimal profile dir under a fresh temp root with a given profile.yml + binding.yml. */
  async function makeProfile(profileYaml: string, bindingRelPath: string, bindingYaml: string): Promise<string> {
    const src = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-src-"));
    await writeFile(path.join(src, "profile.yml"), profileYaml);
    const bindingAbs = path.join(src, bindingRelPath);
    await mkdir(path.dirname(bindingAbs), { recursive: true });
    await writeFile(bindingAbs, bindingYaml);
    return src;
  }

  const PREPARED_BINDING = [
    "# fixture binding",
    "kind: prepared",
    "project: ../examples/jaffle-wren",
    "document: context/context.json",
    "",
  ].join("\n");

  const PROFILE_YAML = ["context:", "  project: ./context/binding.yml", ""].join("\n");

  it("rewrites the binding's project: to the resolved user project path, leaving kind/document as authored", async () => {
    const src = await makeProfile(PROFILE_YAML, "context/binding.yml", PREPARED_BINDING);
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    const composedDir = await composeUserProfile({
      profileSource: src,
      userProject,
      destDir: dest,
      contextLoaderBin: await makeContextLoaderStub(),
    });
    const bindingText = await readFile(path.join(composedDir, "context", "binding.yml"), "utf-8");
    expect(bindingText).toContain(`project: ${path.resolve(userProject)}`);
    expect(bindingText).toContain("kind: prepared");
    // The document path is written to, never rewritten — so it stays exactly as authored.
    expect(bindingText).toContain("document: context/context.json");
    expect(bindingText).toContain("# fixture binding"); // comment preserved
  });

  it("never puts the document's path into project: — project: stays the layer's identity", async () => {
    const src = await makeProfile(PROFILE_YAML, "context/binding.yml", PREPARED_BINDING);
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    const composedDir = await composeUserProfile({
      profileSource: src,
      userProject,
      destDir: dest,
      contextLoaderBin: await makeContextLoaderStub(),
    });
    const projectLine = (await readFile(path.join(composedDir, "context", "binding.yml"), "utf-8"))
      .split("\n")
      .find((line) => line.startsWith("project:"));
    // Substituting the document path here once shipped in Warble and told every compiled prompt the
    // agent was working on a project called "context.json".
    expect(projectLine).toBe(`project: ${path.resolve(userProject)}`);
    expect(projectLine).not.toContain("context.json");
  });

  it("writes the generator's document at the path the binding's document: field names", async () => {
    const src = await makeProfile(PROFILE_YAML, "context/binding.yml", PREPARED_BINDING);
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    const composedDir = await composeUserProfile({
      profileSource: src,
      userProject,
      destDir: dest,
      contextLoaderBin: await makeContextLoaderStub(),
    });

    // `document:` resolves against the Warble project ROOT (the composed dir), not against the
    // binding file's own directory — the stub was handed exactly that absolute path.
    const document = JSON.parse(await readFile(path.join(composedDir, "context", "context.json"), "utf-8"));
    expect(document.project).toBe(path.resolve(userProject));
  });

  it("overwrites the profile's committed fixture document rather than leaving it in place", async () => {
    const src = await makeProfile(PROFILE_YAML, "context/binding.yml", PREPARED_BINDING);
    await writeFile(path.join(src, "context", "context.json"), '{"context_version":1,"project":"COMMITTED-FIXTURE"}');
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    const composedDir = await composeUserProfile({
      profileSource: src,
      userProject,
      destDir: dest,
      contextLoaderBin: await makeContextLoaderStub(),
    });

    const text = await readFile(path.join(composedDir, "context", "context.json"), "utf-8");
    expect(text).not.toContain("COMMITTED-FIXTURE");
    expect(JSON.parse(text).project).toBe(path.resolve(userProject));
  });

  it("loud-fails when the binding omits kind: prepared, instead of compiling against Warble's built-in adapter", async () => {
    const src = await makeProfile(
      PROFILE_YAML,
      "context/binding.yml",
      ["project: ../examples/jaffle-wren", "document: context/context.json", ""].join("\n"),
    );
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    await expect(
      composeUserProfile({
        profileSource: src,
        userProject,
        destDir: dest,
        contextLoaderBin: await makeContextLoaderStub(),
      }),
    ).rejects.toThrow(InvalidProfileShapeError);
  });

  it("propagates a generator failure as ContextLoaderFailedError instead of composing a stale document", async () => {
    const src = await makeProfile(PROFILE_YAML, "context/binding.yml", PREPARED_BINDING);
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    await expect(
      composeUserProfile({
        profileSource: src,
        userProject,
        destDir: dest,
        contextLoaderBin: await makeContextLoaderStub('echo "boom" >&2\nexit 1\n'),
      }),
    ).rejects.toThrow(ContextLoaderFailedError);
  });

  it("loud-fails with PathTraversalError when the document: path escapes the composed dir", async () => {
    const src = await makeProfile(
      PROFILE_YAML,
      "context/binding.yml",
      ["kind: prepared", "project: ./p", "document: ../../../../tmp/evil-context.json", ""].join("\n"),
    );
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    await expect(
      composeUserProfile({
        profileSource: src,
        userProject,
        destDir: dest,
        contextLoaderBin: await makeContextLoaderStub(),
      }),
    ).rejects.toThrow(PathTraversalError);
  });

  it("loud-fails with PathTraversalError when the context pointer escapes the composed dir", async () => {
    const src = await makeProfile(
      ["context:", "  project: ../../../../etc/evil-binding.yml", ""].join("\n"),
      "context/binding.yml",
      PREPARED_BINDING,
    );
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    await expect(
      composeUserProfile({
        profileSource: src,
        userProject,
        destDir: dest,
        contextLoaderBin: await makeContextLoaderStub(),
      }),
    ).rejects.toThrow(PathTraversalError);
  });
});
