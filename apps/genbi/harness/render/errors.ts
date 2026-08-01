/**
 * Thrown when the render envelope stage (the two-stage structured-output
 * synthesis) needs a tier to run on but the caller didn't supply one
 * explicitly and the agent has no `independent` step to fall back to —
 * e.g. an agent made up entirely of `repair_fold` steps. This should never
 * happen for a v1-scoped agent (`executeAgent` already requires at least
 * one independent step to produce anything), but the envelope stage
 * doesn't assume that invariant on its own.
 */
export class NoRenderTierError extends Error {
  constructor(agentId: string) {
    super(
      `agent "${agentId}" has no "independent" step to default the render envelope's ` +
        `tier from, and no explicit tier was supplied to renderEnvelope()`,
    );
    this.name = "NoRenderTierError";
  }
}

/**
 * Thrown when the model's envelope response parses as JSON but doesn't
 * structurally match `agent.output_schema` — checked by hand via
 * `collectJsonSchemaErrors` against the `generateText` output (see
 * `renderEnvelope`; the envelope stage doesn't use `generateObject`'s
 * SDK-level schema enforcement, so this replaces the errors that used to
 * surface as a `NoObjectGeneratedError`'s cause).
 */
export class EnvelopeSchemaError extends Error {
  constructor(agentId: string, violations: readonly string[]) {
    super(
      `agent "${agentId}"'s render envelope does not match its output_schema:\n` +
        violations.map((violation) => `  - ${violation}`).join("\n"),
    );
    this.name = "EnvelopeSchemaError";
  }
}

/**
 * Thrown when the model's envelope response still doesn't extract into
 * parseable JSON after `renderEnvelope`'s one bounded reformat retry (see
 * `extractJsonObjectText`). Distinct from `EnvelopeSchemaError`, which is
 * for JSON that parses but doesn't match `output_schema` — this is for
 * responses that never became valid JSON at all.
 */
export class EnvelopeParseError extends Error {
  constructor(agentId: string, cause: unknown) {
    super(
      `agent "${agentId}"'s render envelope response could not be parsed as JSON after retrying: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "EnvelopeParseError";
    this.cause = cause;
  }
}
