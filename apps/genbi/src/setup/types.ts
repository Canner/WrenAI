/**
 * Setup (onboarding) domain types — an agent-guided, 5-step first-run flow:
 * runtime & models → connect data source → build context → bind profile →
 * ask. Phase 1 is fixture-driven; buttons advance step state locally, there
 * is no backend. See `src/setup/fixtures.ts` for sample data and the
 * "Setup (onboarding)" section of `README.md` for scope.
 */
import type { TierModelBinding } from '@/harness/types';
import type { SetupStatusEvent } from '@/bff/client';
import type { ToolStep } from '@/session/types';

/**
 * `'adopt'` stands in for `'connect'` in the step SEQUENCE (not alongside
 * it) once the wizard's mode is `'adopt'` — the array is always exactly one
 * of the two, never both. See `SetupMode` in `@/bff/client`.
 */
export type StepKey = 'runtime' | 'connect' | 'adopt' | 'context' | 'bind' | 'ask';

export type StepState = 'done' | 'current' | 'todo';

export interface SetupStep {
  key: StepKey;
  title: string;
  state: StepState;
}

export type AuthMode = 'subscription' | 'byo' | 'local';
export type SubscriptionProvider = 'claude' | 'codex';

export type Deployment = 'personal' | 'hosted';

/** The api-key adapter a `'byo'` `RuntimeSettings.authMode` dispatches through. */
export type ApiKeyAdapter = 'anthropic' | 'openai-compatible';
export type RuntimeTierAdapter = ApiKeyAdapter | 'local';

/**
 * Extends the Harness page's tier→model binding shape with the persisted
 * adapter/Base URL choices used to materialize that tier at dispatch time.
 * Tier names remain unrestricted because the compiled profile owns them.
 */
export interface TierModelSelection extends Omit<TierModelBinding, 'model'> {
  model?: string;
  adapter?: RuntimeTierAdapter;
  baseURL?: string;
}

export interface RuntimeSettings {
  authMode: AuthMode;
  subscriptionProvider?: SubscriptionProvider;
  tierModels: TierModelSelection[];
  hybrid: boolean;
  deployment: Deployment;
  /** Which api-key adapter `'byo'` dispatches through. Non-secret — never the key itself. */
  apiKeyAdapter?: ApiKeyAdapter;
  /** Model name override for the api-key adapter. Non-secret. */
  apiKeyModel?: string;
  /** Base URL override, `openai-compatible` only. Non-secret. */
  apiKeyBaseURL?: string;
  /** Separate subscription dispatcher driver model; never a compiled profile tier. */
  subscriptionDriverModel?: string;
}

/** Login availability only. No credential contents or metadata cross this boundary. */
export interface SubscriptionLoginStatus {
  claude: boolean;
  codex: boolean;
}

/** Provider-approved suggestion metadata; model fields remain free-form in Setup. */
export interface SubscriptionModelCatalogEntry {
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  reasoningEfforts?: { value: string; displayName: string; description?: string }[];
}

/** Mirrors the BFF's deliberately narrow model discovery wire contract. */
export type SubscriptionModelCatalog =
  | { version: 1; status: 'ready'; provider: SubscriptionProvider; models: SubscriptionModelCatalogEntry[] }
  | {
      version: 1;
      status: 'unavailable';
      provider: SubscriptionProvider;
      code: 'not_authenticated' | 'runtime_unavailable' | 'timeout' | 'protocol_error';
      retryable: boolean;
    };

/**
 * Whether each api-key adapter's required credential env var is present on the BFF process —
 * booleans only, never the key value/prefix/suffix/length. See `GET /api/config/env-detect`.
 */
export interface AdapterEnvStatus {
  anthropic: boolean;
  openaiCompatible: boolean;
}

/** `PUT /api/config/runtime`'s response — the persisted settings plus any compliance warnings. */
export interface NativeRuntimeBinding {
  configured: boolean;
  generation: number;
  provider?: SubscriptionProvider;
  target?: 'claude-code:interactive' | 'codex:interactive';
  targetLabel?: 'Claude CLI' | 'Codex CLI';
}

export type RuntimeSettingsPutResponse = RuntimeSettings & { warnings: string[]; nativeSessionBinding: NativeRuntimeBinding };

/** Read-only health of the saved Runtime, for correcting legacy settings before dispatch. */
export type RuntimeSettingsReadiness = { valid: true } | { valid: false; correction: string };

export type ConversationRole = 'assistant' | 'user';

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  /** A live agentic step's tool trace, rendered inline via `WorkLog` — set only for stream-driven messages (e.g. connect). */
  workLog?: ToolStep[];
  /** The stream's terminal for a stream-driven message, if this message reports one. */
  terminal?: SetupStatusEvent;
}

/** Safe retry data returned by the BFF; it never includes a provider session anchor. */
export interface SetupFailureRecovery {
  attempt: 'connect' | 'connect_resume' | 'context';
  projectName: string;
  sourceType: string;
  error: string;
  workLog: ToolStep[];
}

/** Safe reload snapshot for a completed setup turn paused on user input. */
export interface SetupNeedsInputRecovery {
  attempt: 'connect' | 'connect_resume' | 'context';
  projectName: string;
  sourceType: string;
  message: string;
  workLog: ToolStep[];
}

/** One selectable data source type offered by the Connect step. */
export interface DataSourceOption {
  key: string;
  label: string;
}

/** Discovered semantic-layer summary shown once the Context step completes. */
export interface ContextSummary {
  models: number;
  relationships: number;
}
