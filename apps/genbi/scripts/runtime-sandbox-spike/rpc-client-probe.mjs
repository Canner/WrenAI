#!/usr/bin/env node

import { spawn } from "node:child_process";
import { RpcClient } from "./rpc-client.mjs";

const rawProtocolContent = "model-output-must-not-leak";
const child = spawn(
  process.execPath,
  [
    "-e",
    [
      'process.stdin.once("data",()=>{',
      `process.stdout.write(${JSON.stringify(rawProtocolContent)}+"\\n");`,
      "setInterval(()=>{},1000);",
      "});",
    ].join(""),
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const rpc = new RpcClient(child);

try {
  const errors = await Promise.all([
    rpc.request("malformed-response-probe-one", {}).then(() => undefined, (reason) => reason),
    rpc.request("malformed-response-probe-two", {}).then(() => undefined, (reason) => reason),
  ]);
  const expectedLength = Buffer.byteLength(rawProtocolContent);
  const expectedPrefixByte = Buffer.from(rawProtocolContent).subarray(0, 1).toString("hex");
  const safelyRejected = errors.length === 2 && errors.every((error) => (
    error instanceof Error
      && error.message.includes(`length=${expectedLength}`)
      && error.message.includes(`prefixByte=${expectedPrefixByte}`)
      && !error.message.includes(rawProtocolContent)
  ));
  if (!safelyRejected) throw new Error("malformed JSON did not reject every pending RPC safely");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      { name: "malformed JSON rejects every pending RPC", ok: true },
      { name: "malformed JSON diagnostics omit raw protocol content", ok: true },
    ],
  }, null, 2)}\n`);
} finally {
  rpc.close();
  await onceExit(child);
}

function onceExit(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => processHandle.once("exit", resolve));
}
