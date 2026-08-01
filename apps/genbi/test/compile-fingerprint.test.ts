import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashDirectory, hashFiles } from "../harness/compile/fingerprint.js";

describe("hashDirectory (content fingerprint)", () => {
  it("changes when a file's CONTENT changes even if size and mtime are held constant", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-"));
    const file = path.join(dir, "model.yml");
    const fixedTime = new Date("2020-01-01T00:00:00Z");

    // Same byte length ("aaaa" -> "bbbb"), same mtime — a size+mtime scheme would collide here.
    await writeFile(file, "aaaa");
    await utimes(file, fixedTime, fixedTime);
    const before = await hashDirectory(dir);

    await writeFile(file, "bbbb");
    await utimes(file, fixedTime, fixedTime);
    const after = await hashDirectory(dir);

    expect(after).not.toBe(before);
  });

  it("is stable when nothing changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-"));
    await writeFile(path.join(dir, "a.yml"), "hello");
    expect(await hashDirectory(dir)).toBe(await hashDirectory(dir));
  });

  it("ignores excluded bulk data files (e.g. *.duckdb) so a data-only change is not a cache miss", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-"));
    await writeFile(path.join(dir, "wren_project.yml"), "catalog: jaffle");
    const dataFile = path.join(dir, "jaffle_shop.duckdb");

    await writeFile(dataFile, "row-data-v1");
    const before = await hashDirectory(dir);
    await writeFile(dataFile, "row-data-v2-longer-payload");
    const after = await hashDirectory(dir);

    expect(after).toBe(before);
  });
});

describe("hashFiles (ordered multi-file content fingerprint, for --provider fragments)", () => {
  it("changes when the resolved provider-fragment SET changes (e.g. a custom options.providers vs. the default)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-providers-"));
    const defaultProvider = path.join(dir, "wren.provider.yaml");
    const customProvider = path.join(dir, "custom.provider.yaml");
    await writeFile(defaultProvider, "capabilities: [default]");
    await writeFile(customProvider, "capabilities: [custom]");

    const defaultHash = await hashFiles([defaultProvider]);
    const customHash = await hashFiles([customProvider]);
    expect(defaultHash).not.toBe(customHash);
  });

  it("changes when a provider fragment's CONTENT changes (e.g. providers/wren.provider.yaml edited, or warble rebuilt with a new default)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-providers-"));
    const provider = path.join(dir, "wren.provider.yaml");

    await writeFile(provider, "capabilities: [a]");
    const before = await hashFiles([provider]);
    await writeFile(provider, "capabilities: [a, b]");
    const after = await hashFiles([provider]);

    expect(after).not.toBe(before);
  });

  it("is order-sensitive: [a, b] and [b, a] hash differently, since dispatch merges fragments in order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-providers-"));
    const a = path.join(dir, "a.provider.yaml");
    const b = path.join(dir, "b.provider.yaml");
    await writeFile(a, "capabilities: [a]");
    await writeFile(b, "capabilities: [b]");

    expect(await hashFiles([a, b])).not.toBe(await hashFiles([b, a]));
  });

  it("distinguishes an empty provider list ([]) from any non-empty set, including the default", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-providers-"));
    const provider = path.join(dir, "wren.provider.yaml");
    await writeFile(provider, "capabilities: [default]");

    expect(await hashFiles([])).not.toBe(await hashFiles([provider]));
  });

  it("is stable when nothing changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fp-providers-"));
    const provider = path.join(dir, "wren.provider.yaml");
    await writeFile(provider, "capabilities: [stable]");

    expect(await hashFiles([provider])).toBe(await hashFiles([provider]));
  });
});
