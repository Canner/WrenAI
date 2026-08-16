import type { NativeProducerArtifactReference, NativeProducerHostFence, NativeProducerRequest } from "../harness/native-producer/index.js";
import { createHash } from "node:crypto";
import type { EnrichmentBinding } from "./enrichment.js";
import type { Store } from "./db.js";

/**
 * Bridges the producer's public-safe scope to the same durable native-session
 * and live-binding fence used by native artifact persistence. No path, token,
 * or session credential is returned to the producer contract.
 */
export function createNativeProducerHostFence(input: {
  readonly store: Store;
  readonly getBinding: () => EnrichmentBinding | undefined;
  /** Selected by the server from durable native-session state; never public. */
  readonly nativeSessionId: string;
}): NativeProducerHostFence {
  const session = input.store.getNativeSession(input.nativeSessionId);
  const binding = input.getBinding();
  if (!session || !binding || !matchesBinding(session, binding)) {
    throw new Error("cannot create a native producer fence without a live bound native session");
  }
  const bindingDigest = digestBinding(session.id, binding);

  const validRun = (request: NativeProducerRequest, userProject?: string): boolean => {
    const live = input.getBinding();
    const currentSession = input.store.getNativeSession(input.nativeSessionId);
    return Boolean(
      live && currentSession && userProject !== undefined && live.path === userProject &&
      request.scope.bindingDigest === bindingDigest &&
      matchesBinding(currentSession, live) && currentSession.vendor === request.vendor &&
      (currentSession.status === "running" || currentSession.status === "detached"),
    );
  };
  return {
    bindingDigest,
    validateRun: (request) => validRun(request, input.getBinding()?.path),
    validateRoute: validRun,
    validateArtifact: (artifact: NativeProducerArtifactReference, request) => {
      const live = input.getBinding();
      const currentSession = input.store.getNativeSession(input.nativeSessionId);
      if (!live || !currentSession || !validRun(request, live.path) || !matchesBinding(currentSession, live)) return false;
      const row = input.store.getArtifact(artifact.id);
      return Boolean(
        row && row.nativeSessionId === input.nativeSessionId &&
        row.projectIdentity === live.identity && row.bindingGeneration === live.generation && row.projectRevision === live.revision &&
        row.contentDigest === artifact.digest && row.idempotencyKey === artifact.idempotencyKey,
      );
    },
  };
}

function matchesBinding(
  session: { projectIdentity: string | null; bindingGeneration: number | null; projectRevision: string | null },
  binding: EnrichmentBinding,
): boolean {
  return session.projectIdentity === binding.identity &&
    session.bindingGeneration === binding.generation && session.projectRevision === binding.revision;
}

function digestBinding(nativeSessionId: string, binding: EnrichmentBinding): string {
  // Delimit and length-prefix each private value so different tuples cannot
  // collide through concatenation. Only this one-way digest leaves the host.
  const fields = [nativeSessionId, binding.identity, String(binding.generation), binding.revision];
  const encoded = fields.map((field) => `${Buffer.byteLength(field)}:${field}`).join("|");
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}
