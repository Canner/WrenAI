// Test-only host IPC peer, authored against the public host request contract and
// published Cedar API. No model execution or production runtime implementation.
const readline = require("node:readline");
const cedar = require("@cedar-policy/cedar-wasm/nodejs");
const protocol = "warble-private-service/1";
let policies;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");

function authorize(request) {
  const principal = { type: "Service::Principal", id: request.caller };
  const resource = { type: "Service::Resource", id: `${request.kind}:${request.name}` };
  const entities = [
    { uid: principal, parents: [], attrs: {
      caller: request.caller, project: request.project, role: request.role,
      session: request.session, epoch: request.epoch,
    } },
    { uid: resource, parents: [], attrs: {
      project: request.project, kind: request.kind, name: request.name,
      columns: request.columns, recipient: request.recipient,
    } },
  ];
  // The host passes independent policy sets: each must permit. Parse/evaluation
  // errors never become an allow, even if another permit policy matched.
  return policies.length > 0 && policies.every((policy) => {
    const answer = cedar.isAuthorized({ principal, resource,
      action: { type: "Service::Action", id: request.action }, context: {}, entities,
      policies: { staticPolicies: policy },
    });
    return answer.type === "success" && answer.response.decision === "allow"
      && answer.response.diagnostics.errors.length === 0;
  });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
    if (frame.op === "init" && !policies && frame.protocol === protocol
      && Array.isArray(frame.policies) && frame.policies.every((p) => typeof p === "string")) {
      policies = frame.policies;
      return send({ id: frame.id, value: { protocol, ir: "0.9", schema: "1" } });
    }
    if (frame.op === "authorize" && policies) {
      return send({ id: frame.id, value: authorize(frame.request) });
    }
    throw new Error("unsupported_test_operation");
  } catch {
    // A malformed policy/request is denied; unsupported operations cannot run SQL.
    if (frame) send({ id: frame.id, value: false });
  }
});
