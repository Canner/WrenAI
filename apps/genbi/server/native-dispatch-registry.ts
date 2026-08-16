/**
 * Closed native-session dispatch contract.  The browser supplies a product
 * purpose only; this module resolves the fixed Warble profile plus the one
 * interactive target selected by the saved Runtime configuration.
 */
import type { InteractiveTarget } from "./interactive-terminal.js";
import type { RuntimeSettings, SubscriptionProvider } from "./wire-types.js";

export const NATIVE_PURPOSES = ["analysis", "setup", "context_enrichment"] as const;
export type NativePurpose = (typeof NATIVE_PURPOSES)[number];
export type NativeVendor = SubscriptionProvider;

export interface NativeDispatchDefinition {
  readonly purpose: NativePurpose;
  readonly profile: "genbi-default" | "genbi-setup" | "genbi-enrich-context";
  readonly scopeKind: "bootstrap" | "bound_project";
}

export const NATIVE_DISPATCH_REGISTRY: Readonly<Record<NativePurpose, NativeDispatchDefinition>> = {
  setup: { purpose: "setup", profile: "genbi-setup", scopeKind: "bootstrap" },
  analysis: { purpose: "analysis", profile: "genbi-default", scopeKind: "bound_project" },
  context_enrichment: { purpose: "context_enrichment", profile: "genbi-enrich-context", scopeKind: "bound_project" },
};

/** Stable, read-only response for a source or compiled-bundle identity mismatch. */
export const HARNESS_PROFILE_IDENTITY_ERROR = "harness profile identity does not match the requested read-only purpose";

/**
 * Every Harness source and emitted bundle must retain the fixed identity for
 * the closed purpose chosen by the BFF. This is deliberately independent of
 * browser input: callers choose a purpose, never a profile authority.
 */
export function assertHarnessPurposeProfile(purpose: NativePurpose, profile: string): void {
  if (profile !== NATIVE_DISPATCH_REGISTRY[purpose].profile) {
    throw new Error(HARNESS_PROFILE_IDENTITY_ERROR);
  }
}

export interface NativeRuntimeBinding {
  readonly configured: boolean;
  readonly generation: number;
  readonly provider?: NativeVendor;
  readonly target?: InteractiveTarget;
  readonly targetLabel?: "Claude CLI" | "Codex CLI";
}

export function targetForProvider(provider: NativeVendor): InteractiveTarget {
  return provider === "claude" ? "claude-code:interactive" : "codex:interactive";
}

export function nativeTargetLabel(provider: NativeVendor): "Claude CLI" | "Codex CLI" {
  return provider === "claude" ? "Claude CLI" : "Codex CLI";
}

/** Explicit marker, not seed/default settings, is the authority. */
export function resolveNativeRuntimeBinding(settings: RuntimeSettings, explicit: boolean, generation: number): NativeRuntimeBinding {
  if (!explicit || settings.authMode !== "subscription" || (settings.subscriptionProvider !== "claude" && settings.subscriptionProvider !== "codex")) {
    return { configured: false, generation };
  }
  const provider = settings.subscriptionProvider;
  return { configured: true, generation, provider, target: targetForProvider(provider), targetLabel: nativeTargetLabel(provider) };
}

/** A launch may proceed only while the whole captured Runtime authority remains current. */
export function sameNativeRuntimeBinding(left: NativeRuntimeBinding, right: NativeRuntimeBinding): boolean {
  return left.configured === right.configured
    && left.generation === right.generation
    && left.provider === right.provider
    && left.target === right.target
    && left.targetLabel === right.targetLabel;
}

export function dispatchForPurpose(purpose: NativePurpose, binding: NativeRuntimeBinding): NativeDispatchDefinition & { readonly provider: NativeVendor; readonly target: InteractiveTarget; readonly targetLabel: "Claude CLI" | "Codex CLI" } | undefined {
  if (!binding.configured || !binding.provider || !binding.target || !binding.targetLabel) return undefined;
  return { ...NATIVE_DISPATCH_REGISTRY[purpose], provider: binding.provider, target: binding.target, targetLabel: binding.targetLabel };
}
