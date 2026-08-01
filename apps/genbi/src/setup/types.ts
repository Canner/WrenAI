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

export type Deployment = 'personal' | 'hosted';

/** The api-key adapter a `'byo'` `RuntimeSettings.authMode` dispatches through. */
export type ApiKeyAdapter = 'anthropic' | 'openai-compatible';

export type ModelTier = 'orchestrator' | 'strong' | 'cheap';

/**
 * Alias of the Harness page's tier→model binding shape (`{ tier, model }`) so
 * the two surfaces never drift. Setup only configures the orchestrator / strong
 * / cheap tiers (its fixtures use exactly those), but the type is not narrowed.
 */
export type TierModelSelection = TierModelBinding;

export interface RuntimeSettings {
  authMode: AuthMode;
  tierModels: TierModelSelection[];
  hybrid: boolean;
  deployment: Deployment;
  /** Which api-key adapter `'byo'` dispatches through. Non-secret — never the key itself. */
  apiKeyAdapter?: ApiKeyAdapter;
  /** Model name override for the api-key adapter. Non-secret. */
  apiKeyModel?: string;
  /** Base URL override, `openai-compatible` only. Non-secret. */
  apiKeyBaseURL?: string;
}

/**
 * Whether each api-key adapter's required credential env var is present on the BFF process —
 * booleans only, never the key value/prefix/suffix/length. See `GET /api/config/env-detect`.
 */
export interface AdapterEnvStatus {
  anthropic: boolean;
  openaiCompatible: boolean;
}

/** `PUT /api/config/runtime`'s response — the persisted settings plus any compliance warnings. */
export type RuntimeSettingsPutResponse = RuntimeSettings & { warnings: string[] };

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

/** One selectable data source type offered by the Connect step. */
export interface DataSourceOption {
  key: string;
  label: string;
}

/** Discovered semantic-layer summary shown once the Context step completes. */
export interface ContextSummary {
  models: number;
  measures: number;
  knowledgeNotes: number;
}
