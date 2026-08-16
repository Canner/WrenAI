/**
 * Persistent sealing for provider-owned native conversation identifiers.
 *
 * The SQLite database holds ciphertext only. Its AES key is a separate,
 * private BFF-state file, so a copied database neither reveals nor authorizes
 * a provider conversation. This is intentionally local-state encryption, not
 * a browser capability or a general-purpose secret store.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { InteractiveLaunchError, validateNativeSessionStateBase } from "./native-session-workspace.js";
import type { NativeSessionStateBase } from "./native-session-workspace.js";

const KEY_FILE = "native-resume-key-v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Envelope = { readonly version: "1"; readonly iv: string; readonly tag: string; readonly ciphertext: string };

function keyPath(state: NativeSessionStateBase): string {
  const root = validateNativeSessionStateBase(state).root;
  const file = path.join(root, KEY_FILE);
  if (path.dirname(file) !== root) throw new InteractiveLaunchError("native session resume storage is unavailable");
  return file;
}

function loadOrCreateKey(state: NativeSessionStateBase): Buffer {
  const file = keyPath(state);
  if (!existsSync(file)) {
    const key = randomBytes(KEY_BYTES);
    try {
      const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try { writeFileSync(fd, key); } finally { closeSync(fd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new InteractiveLaunchError("native session resume storage is unavailable");
    }
  }
  try {
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || realpathSync(file) !== file) throw new Error("unsafe key file");
    const key = readFileSync(file);
    if (key.length !== KEY_BYTES) throw new Error("wrong key length");
    return key;
  } catch {
    throw new InteractiveLaunchError("native session resume storage is unavailable");
  }
}

function parseEnvelope(value: string): Envelope | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<Envelope>;
    if (parsed.version !== "1" || typeof parsed.iv !== "string" || typeof parsed.tag !== "string" || typeof parsed.ciphertext !== "string") return undefined;
    const iv = Buffer.from(parsed.iv, "base64url"); const tag = Buffer.from(parsed.tag, "base64url"); const ciphertext = Buffer.from(parsed.ciphertext, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length < 1) return undefined;
    return { version: "1", iv: parsed.iv, tag: parsed.tag, ciphertext: parsed.ciphertext };
  } catch { return undefined; }
}

export type NativeResumeProvider = "claude" | "codex";

function aad(sessionId: string, provider: NativeResumeProvider): Buffer { return Buffer.from(`genbi-native-resume-v1\u0000${provider}\u0000${sessionId}`, "utf8"); }

export function sealNativeResumeHandle(state: NativeSessionStateBase, sessionId: string, provider: NativeResumeProvider, handle: string): string {
  if (!UUID.test(handle)) throw new InteractiveLaunchError("native session resume handle is invalid");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", loadOrCreateKey(state), iv);
  cipher.setAAD(aad(sessionId, provider));
  const ciphertext = Buffer.concat([cipher.update(handle, "utf8"), cipher.final()]);
  const envelope: Envelope = { version: "1", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  return JSON.stringify(envelope);
}

export function unsealNativeResumeHandle(state: NativeSessionStateBase, sessionId: string, provider: NativeResumeProvider, sealed: string): string {
  const envelope = parseEnvelope(sealed);
  if (!envelope) throw new InteractiveLaunchError("native session resume handle is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", loadOrCreateKey(state), Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(aad(sessionId, provider));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const handle = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    if (!UUID.test(handle)) throw new Error("invalid handle");
    return handle;
  } catch (error) {
    if (error instanceof InteractiveLaunchError) throw error;
    throw new InteractiveLaunchError("native session resume handle is unavailable");
  }
}

export const sealNativeClaudeResumeHandle = (state: NativeSessionStateBase, sessionId: string, handle: string): string =>
  sealNativeResumeHandle(state, sessionId, "claude", handle);
export const unsealNativeClaudeResumeHandle = (state: NativeSessionStateBase, sessionId: string, sealed: string): string =>
  unsealNativeResumeHandle(state, sessionId, "claude", sealed);
