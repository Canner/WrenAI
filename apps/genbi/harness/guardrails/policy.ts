import type { Agent } from "../bundle/schema.js";

const READ_ONLY_ENFORCEMENT = "read_only";
const SCOPED_WRITE_ENFORCEMENT = "scoped_write";

const ROW_LIMIT_GUARDRAIL = "row_limit";
const STATEMENT_TIMEOUT_GUARDRAIL = "statement_timeout";
const DRILL_DEPTH_LIMIT_GUARDRAIL = "drill_depth_limit";

/**
 * The enforcement policy derived from an agent's `guardrails` map: a
 * machine-readable summary an `ExecutionEnv`
 * (`harness/exec/`) can act on directly. Deliberately excludes `gated_check`
 * (`deterministic_gate` / `additivity_guard`) — `harness/session/gate.ts`
 * already owns that guardrail's enforcement against the rendered envelope,
 * and duplicating it here would just be two places to keep in sync.
 *
 * For `mcp:<server>/<name>` tools (e.g. `query`), the harness never executes
 * the tool in-process — the MCP server does — so `rowLimit` /
 * `statementTimeoutSec` (and `readOnly` for SQL access) are *not* enforced
 * by this policy directly. They must be passed to the MCP server via its
 * connection config (`McpServerConfig`, `harness/tools/mcp.ts`) or honored by
 * the server's own semantics (e.g. a read-only DB role, a statement
 * timeout on the connection). This module only derives the values; wiring
 * them into a real server's connection is a caller/deployment concern this
 * harness does not — and should not pretend to — enforce on the server's
 * behalf.
 */
export interface EnforcementPolicy {
  readonly readOnly: boolean;
  readonly artifactWriteScope?: string;
  readonly rowLimit?: number;
  readonly statementTimeoutSec?: number;
  readonly drillDepthLimit?: number;
}

/**
 * Maps an agent's `guardrails` to the harness's enforcement seams: a locked
 * `read_only` guardrail sets `readOnly`; a locked `scoped_write` guardrail
 * (with a `scope`) sets `artifactWriteScope`; `threshold_limit` / `generic`
 * guardrails are matched by guardrail *key* (not just `enforcement`, since
 * `row_limit` and `drill_depth_limit` share the `threshold_limit`
 * enforcement kind) onto named numeric limits.
 *
 * `read_only_execution` and a locked `scoped_write` guardrail coexisting
 * (`generate_dashboard`, `explain_change` in the golden bundle) is not a
 * contradiction: the former restricts *data access* (no write-capable
 * SQL/tool becomes active), the latter grants a narrow, separate permission
 * to write the rendered *output artifact* inside `scope`. This is exactly
 * why the two fields are independent here rather than one overriding the
 * other — `LocalExecutionEnv.writeFile` (`harness/exec/local.ts`) reflects this
 * directly, consulting only `artifactWriteScope`, never `readOnly`.
 */
export function deriveEnforcement(agent: Agent): EnforcementPolicy {
  let readOnly = false;
  let artifactWriteScope: string | undefined;
  let rowLimit: number | undefined;
  let statementTimeoutSec: number | undefined;
  let drillDepthLimit: number | undefined;

  for (const [key, guardrail] of Object.entries(agent.guardrails)) {
    if (guardrail.enforcement === READ_ONLY_ENFORCEMENT && guardrail.locked) {
      readOnly = true;
      continue;
    }
    if (guardrail.enforcement === SCOPED_WRITE_ENFORCEMENT && guardrail.locked && guardrail.scope !== undefined) {
      artifactWriteScope = guardrail.scope;
      continue;
    }
    if (guardrail.threshold === undefined) continue;
    if (key === ROW_LIMIT_GUARDRAIL) {
      rowLimit = guardrail.threshold;
    } else if (key === STATEMENT_TIMEOUT_GUARDRAIL) {
      statementTimeoutSec = guardrail.threshold;
    } else if (key === DRILL_DEPTH_LIMIT_GUARDRAIL) {
      drillDepthLimit = guardrail.threshold;
    }
  }

  return {
    readOnly,
    ...(artifactWriteScope !== undefined ? { artifactWriteScope } : {}),
    ...(rowLimit !== undefined ? { rowLimit } : {}),
    ...(statementTimeoutSec !== undefined ? { statementTimeoutSec } : {}),
    ...(drillDepthLimit !== undefined ? { drillDepthLimit } : {}),
  };
}
