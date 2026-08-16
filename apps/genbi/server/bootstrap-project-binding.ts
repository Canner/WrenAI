import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Store } from "./db.js";
import { resolveProjectIdentity } from "./enrichment.js";

function escapes(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/**
 * Recover the in-memory project binding after a bootstrap-mode BFF restart.
 *
 * `bindProject` already persists an identity-fenced enrichment binding when
 * Setup accepts a connected project. The process-local `boundProject` pointer
 * used by the remaining Setup routes must be reconstructed from that durable
 * proof, not from the setup form alone: the form is user input and a stale or
 * replaced directory must remain unbound.
 */
export function recoverBootstrapProjectBinding(store: Store, workspaceRoot: string): string | undefined {
  const form = store.getSetupConnectForm();
  const stored = store.getEnrichmentBinding();
  if (!form || !stored) return undefined;

  try {
    const canonicalWorkspace = realpathSync(workspaceRoot);
    const requested = path.resolve(workspaceRoot, form.projectName);
    if (escapes(path.resolve(workspaceRoot), requested)) return undefined;

    const identity = resolveProjectIdentity(requested);
    if (escapes(canonicalWorkspace, identity.path)) return undefined;
    if (identity.path !== stored.path || identity.identity !== stored.identity) return undefined;
    if (!existsSync(path.join(identity.path, "wren_project.yml"))) return undefined;
    if (!existsSync(path.join(identity.path, ".wren-validated"))) return undefined;
    return identity.path;
  } catch {
    return undefined;
  }
}
