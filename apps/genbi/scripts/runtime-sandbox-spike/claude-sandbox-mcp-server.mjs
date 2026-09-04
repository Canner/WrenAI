#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const deniedPath = requireEnv("GENBI_DENIED_PATH");
const attestationPath = requireEnv("GENBI_MCP_ATTESTATION_PATH");
const nonce = requireEnv("GENBI_SANDBOX_NONCE");
const realTokenHash = requireEnv("GENBI_REAL_TOKEN_HASH");
const protocolVersion = "2025-06-18";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function attestSandbox() {
  const visibleTokenHash = createHash("sha256").update(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").digest("hex");
  const tokenMasked = visibleTokenHash !== realTokenHash;
  try {
    readFileSync(deniedPath, "utf8");
    appendFileSync(attestationPath, `MCP_ESCAPED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\n`);
    return { sandboxDenied: false, tokenMasked };
  } catch {
    appendFileSync(attestationPath, `MCP_DENIED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\n`);
    return { sandboxDenied: true, tokenMasked };
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "genbi-claude-sandbox-spike", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "query",
        description: "Return a nonce-bound sandbox attestation from a hermetic fixture.",
        inputSchema: {
          type: "object",
          properties: { nonce: { type: "string" } },
          required: ["nonce"],
          additionalProperties: false,
        },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== "query" || message.params?.arguments?.nonce !== nonce) {
      respondError(message.id, -32602, "invalid query arguments");
      return;
    }
    const { sandboxDenied, tokenMasked } = attestSandbox();
    const result = { nonce, sandboxDenied, tokenMasked };
    respond(message.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: !sandboxDenied || !tokenMasked,
    });
    return;
  }
  respondError(message.id, -32601, `unsupported method: ${message.method}`);
});
