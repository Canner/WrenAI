import type {
  ContextSummary,
  ConversationMessage,
  DataSourceOption,
  RuntimeSettings,
  SetupStep,
} from './types';

/**
 * Fixture data for the Setup (onboarding) page. Phase 1 renders entirely
 * from these mocks (no backend) — obviously synthetic, no customer data. See
 * `src/fixtures/index.ts` for the app-wide fixture convention this follows.
 */

/** First-run steps: step 1 current, the rest todo. */
export const fixtureSetupSteps: SetupStep[] = [
  { key: 'runtime', title: 'Runtime & models', state: 'current' },
  { key: 'connect', title: 'Connect data source', state: 'todo' },
  { key: 'context', title: 'Build context', state: 'todo' },
  { key: 'bind', title: 'Bind profile', state: 'todo' },
  { key: 'ask', title: 'Ask', state: 'todo' },
];

/** Model options offered per tier — same fixture model names as the Harness page. */
export const fixtureModelOptions: string[] = ['claude-opus', 'claude-sonnet', 'claude-haiku'];

export const fixtureRuntimeSettings: RuntimeSettings = {
  authMode: 'subscription',
  tierModels: [
    { tier: 'orchestrator', model: 'claude-opus' },
    { tier: 'strong', model: 'claude-sonnet' },
    { tier: 'cheap', model: 'claude-haiku' },
  ],
  hybrid: false,
  deployment: 'personal',
};

export const fixtureDataSourceOptions: DataSourceOption[] = [
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'bigquery', label: 'BigQuery' },
  { key: 'snowflake', label: 'Snowflake' },
  { key: 'duckdb', label: 'Local file (CSV / DuckDB)' },
];

export const fixtureContextSummary: ContextSummary = {
  models: 6,
  measures: 9,
  knowledgeNotes: 3,
};

export const fixtureInitialMessage: ConversationMessage = {
  id: 'm0',
  role: 'assistant',
  text:
    "Let's get your workspace ready. Start with runtime & models below — " +
    'pick how you authenticate and which model backs each tier.',
};
