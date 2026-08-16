import type {
  ContextSummary,
  ConversationMessage,
  DataSourceOption,
  RuntimeSettings,
  SetupStep,
} from './types';

/**
 * Fixture data for the Setup (onboarding) page's no-BFF demo mode. Live mode
 * replaces runtime settings and tier names with BFF-owned values; these mocks
 * are synthetic and contain no customer data.
 */

/** First-run steps: step 1 current, the rest todo. */
export const fixtureSetupSteps: SetupStep[] = [
  { key: 'runtime', title: 'Runtime & models', state: 'current' },
  { key: 'connect', title: 'Connect data source', state: 'todo' },
  { key: 'context', title: 'Build data model', state: 'todo' },
  { key: 'bind', title: 'Bind profile', state: 'todo' },
  { key: 'ask', title: 'Ask', state: 'todo' },
];

export const fixtureTierModelsBySubscriptionProvider = {
  claude: [
    { tier: 'strong', model: '' },
    { tier: 'cheap', model: '' },
  ],
  codex: [
    { tier: 'strong', model: '' },
    { tier: 'cheap', model: '' },
  ],
} satisfies Record<'claude' | 'codex', RuntimeSettings['tierModels']>;

export const fixtureRuntimeSettings: RuntimeSettings = {
  authMode: 'subscription',
  subscriptionProvider: 'claude',
  tierModels: fixtureTierModelsBySubscriptionProvider.claude,
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
  relationships: 3,
};

export const fixtureInitialMessage: ConversationMessage = {
  id: 'm0',
  role: 'assistant',
  text:
    "Let's get your workspace ready. Start with runtime & models below — " +
    'pick how you authenticate and which model backs each tier.',
};
