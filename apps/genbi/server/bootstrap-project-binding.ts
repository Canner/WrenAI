import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Store } from "./db.js";
import { resolveProjectIdentity } from "./enrichment.js";

function escapes(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/**
 * Recover the in-memory project binding after a BFF restart.
 *
 * `bindProject` already persists an identity-fenced enrichment binding when
 * Setup accepts a project. The process-local `boundProject` pointer used by the
 * remaining Setup routes must be reconstructed from that durable proof, not
 * from the setup form alone: the form is user input and a stale or replaced
 * directory must remain unbound.
 *
 * The wizard's two entry paths leave different durable evidence, so recovery
 * branches on the persisted `setup.mode` rather than applying one set of
 * checks to both:
 *
 * - `"create"` scaffolds INTO the workspace root, and its connect turn writes
 *   the `.wren-validated` sentinel only after `wren profile add` genuinely
 *   validates the connection. Both facts are load-bearing evidence there, so
 *   that path keeps the workspace fence and the sentinel check.
 * - `"adopt"` takes a project the user already has, anywhere on disk. Neither
 *   piece of evidence exists for it — containment is false by construction and
 *   the sentinel belongs to a flow that never ran. What stands in for them is
 *   that `bindProject` is reached only after adopt verification succeeds
 *   (`POST /api/setup/adopt`), so a *persisted binding at all* is that flow's
 *   equivalent proof.
 *
 * Identity equality is required on both paths and is what actually fences the
 * adopt case: `resolveProjectIdentity` resolves device+inode, so a symlink
 * repointed at another directory — or a different directory moved into the
 * recorded path — no longer matches and stays unbound.
 */
export function recoverBootstrapProjectBinding(store: Store, workspaceRoot: string): string | undefined {
  const stored = store.getEnrichmentBinding();
  if (!stored) return undefined;

  try {
    if (store.getSetupMode() === "adopt") {
      const identity = resolveProjectIdentity(stored.path);
      if (identity.path !== stored.path || identity.identity !== stored.identity) return undefined;
      if (!existsSync(path.join(identity.path, "wren_project.yml"))) return undefined;
      return identity.path;
    }

    const form = store.getSetupConnectForm();
    if (!form) return undefined;

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
