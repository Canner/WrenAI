#!/usr/bin/env node
/** Release-only handoff: bind a new npm package to one approved release manifest. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [approvedPath, packageRoot] = process.argv.slice(2);
if (!approvedPath || !packageRoot) throw new Error("usage: anchor-managed-wren-manifest.mjs <approved-manifest.json> <package-root>");
const bytes = await readFile(approvedPath);
const approved = JSON.parse(bytes);
if (approved.activation !== "approved" || approved.licenseApproval?.state !== "approved" || typeof approved.python?.mirror?.url !== "string") throw new Error("approved manifest required");
const manifestPath = path.join(packageRoot, "managed-wren", "manifest.json");
const staged = JSON.parse(await readFile(manifestPath, "utf8"));
if (staged.activation !== "staged") throw new Error("package manifest must remain staged");
if (JSON.stringify(staged.compatibility) !== JSON.stringify(approved.compatibility) || JSON.stringify(staged.python) !== JSON.stringify(approved.python) || JSON.stringify(staged.wheels) !== JSON.stringify(approved.wheels)) throw new Error("approved manifest release identity differs from staged package");
staged.approvedManifest = { url: approved.python.mirror.url.replace(/\/[^/]+$/, "/managed-wren-manifest.json"), sha256: createHash("sha256").update(bytes).digest("hex") };
await writeFile(manifestPath, JSON.stringify(staged, null, 2) + "\n");
