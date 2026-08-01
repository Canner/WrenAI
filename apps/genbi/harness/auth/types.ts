/**
 * The four credential modes an operator can pick between when a harness
 * needs to talk to a model provider. This module only *models* the choice
 * and enumerates which options are available (offline, from an injected
 * `LoginProbe`) — it does not route requests through any of them (that's a
 * later milestone) and does not apply any compliance/policy judgment on top
 * of the raw availability signal.
 */

/** Reuse an existing CLI subscription session (e.g. an already-`claude login`'d shell). */
export interface SubscriptionAuthChoice {
  readonly mode: "subscription";
  readonly provider: "claude" | "codex";
}

/** Call a provider directly with an API key. Adapter/config shape is filled in by routing (later milestone). */
export interface ApiKeyAuthChoice {
  readonly mode: "api-key";
  readonly adapter: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Talk to a model served on the local machine/network (e.g. Ollama). */
export interface LocalAuthChoice {
  readonly mode: "local";
  readonly endpoint?: string;
}

/** Route through an operator-managed gateway. Config shape is filled in by routing (later milestone). */
export interface GatewayAuthChoice {
  readonly mode: "gateway";
  readonly config?: Readonly<Record<string, unknown>>;
}

/** The full set of credential choices as an explicit, exhaustive union. */
export type AuthChoice = SubscriptionAuthChoice | ApiKeyAuthChoice | LocalAuthChoice | GatewayAuthChoice;

/** One entry in the menu `detectAndPick` enumerates: a mode plus whatever's needed to build its `AuthChoice`. */
export type AuthOption =
  | { readonly mode: "subscription"; readonly provider: "claude" | "codex" }
  | { readonly mode: "api-key" }
  | { readonly mode: "local" }
  | { readonly mode: "gateway" };
