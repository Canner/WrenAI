import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeUserProfile,
  extractContextBindingPath,
  rewriteContextBindingProject,
} from "../harness/compile/compose-profile.js";
import { InvalidProfileShapeError } from "../harness/compile/errors.js";
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

describe("composeUserProfile", () => {
  /** Builds a minimal profile dir under a fresh temp root with a given profile.yml + binding.yml. */
  async function makeProfile(profileYaml: string, bindingRelPath: string, bindingYaml: string): Promise<string> {
    const src = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-src-"));
    await writeFile(path.join(src, "profile.yml"), profileYaml);
    const bindingAbs = path.join(src, bindingRelPath);
    await mkdir(path.dirname(bindingAbs), { recursive: true });
    await writeFile(bindingAbs, bindingYaml);
    return src;
  }

  it("rewrites the binding's project: to the resolved user project path", async () => {
    const src = await makeProfile(
      ["context:", "  project: ./context/binding.yml", ""].join("\n"),
      "context/binding.yml",
      ["# fixture binding", "project: ../examples/jaffle-wren", ""].join("\n"),
    );
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    const composedDir = await composeUserProfile({ profileSource: src, userProject, destDir: dest });
    const bindingText = await readFile(path.join(composedDir, "context", "binding.yml"), "utf-8");
    expect(bindingText).toContain(`project: ${path.resolve(userProject)}`);
    expect(bindingText).toContain("# fixture binding"); // comment preserved
  });

  it("loud-fails with PathTraversalError when the context pointer escapes the composed dir", async () => {
    const src = await makeProfile(
      ["context:", "  project: ../../../../etc/evil-binding.yml", ""].join("\n"),
      "context/binding.yml",
      "project: ./whatever\n",
    );
    const dest = await mkdtemp(path.join(os.tmpdir(), "wren-harness-profile-dest-"));
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-user-project-"));

    await expect(composeUserProfile({ profileSource: src, userProject, destDir: dest })).rejects.toThrow(
      PathTraversalError,
    );
  });
});
