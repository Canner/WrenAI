import { deriveRealizationLabel } from './realization';
import type { AgentProfileRow, Component, ConnectionStatus, HarnessView, ProfileInfo, RuntimeInfo } from './types';

/**
 * Fixture data for the Harness page. Mirrors the shape and vocabulary of the
 * real `genbi-default` bundle (a compiled snapshot is checked in at
 * `fixtures/genbi-default.bundle.json`) so fixture mode exercises the same
 * warble-native capability/guardrail/step ids a live BFF would return — but
 * every identifier below (bound context, connection, bundle hash) is obviously
 * synthetic, no customer data.
 *
 * `monitor_freshness` below is a synthetic fixture-only addition (not part of
 * genbi-default) that mirrors the anatomy of the hub's `monitor_freshness`
 * component — an `assertive` / `tool` / `scheduled` component with an
 * `assertion` outcome — so fixture mode also exercises the anatomy positions
 * the real genbi-default agents never touch.
 */

const fixtureProfile: ProfileInfo = {
  id: 'genbi-default',
  name: 'Genbi Default',
  boundContext: 'jaffle-wren',
  verifyGate: true,
  bundleId: 'genbi-default@claude-agent-sdk:local',
  bundleVersion: '0.1',
  irVersion: '0.3',
  dispatchTarget: 'claude-agent-sdk:local',
  bundleHash: '4a7f9c2',
  status: 'Bound',
};

const fixtureRuntime: RuntimeInfo = {
  backend: 'subscription',
  label: 'Subscription (claude)',
  tierModels: [
    { tier: 'cheap', model: 'claude-haiku' },
    { tier: 'strong', model: 'claude-sonnet' },
  ],
  dispatcher: 'claude-agent-sdk',
};

const fixtureConnection: ConnectionStatus = {
  type: 'PostgreSQL',
  location: 'analytics-prod',
  via: 'query engine',
  tablesSynced: 14,
  lastSync: '5m ago',
  health: 'healthy',
};

/** Derives `realizationLabel` the same way `getHarness` does, so the two can never drift. */
function withRealizationLabel(component: Omit<Component, 'realizationLabel'>): Component {
  return {
    ...component,
    realizationLabel: deriveRealizationLabel(component.realizationKind, component.steps, component.trigger),
  };
}

const exploreModel: Component = withRealizationLabel({
  id: 'explore_model',
  name: 'Explore Model',
  componentType: 'analytical',
  realizationKind: 'skill',
  trigger: 'one_shot',
  outcome: 'none',
  callableAs: 'explore_model',
  model: 'claude-haiku',
  tiers: [{ tier: 'cheap', model: 'claude-haiku' }],
  capabilities: [
    { capability: 'semantic_introspection', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:cheap', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
  ],
  guardrails: [{ name: 'read_only_execution', enforcement: 'read_only', locked: true }],
  tools: [{ name: 'semantic_introspect', source: 'mcp:sample/semantic_introspect' }],
  outputBlocks: [],
  steps: [
    {
      name: 'summarize_semantics',
      tier: 'cheap',
      consumes: ['raw_introspect_result'],
      produces: 'semantic_summary',
      realization: 'independent',
    },
  ],
  status: 'ready',
});

const answerQuery: Component = withRealizationLabel({
  id: 'answer_query',
  name: 'Answer Query',
  componentType: 'analytical',
  realizationKind: 'skill',
  trigger: 'one_shot',
  outcome: 'none',
  callableAs: 'answer_query',
  model: 'claude-sonnet',
  tiers: [
    { tier: 'cheap', model: 'claude-haiku' },
    { tier: 'strong', model: 'claude-sonnet' },
  ],
  capabilities: [
    { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:per_step_tier', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:strong', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:cheap', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'render_contract', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
  ],
  guardrails: [
    { name: 'deterministic_gate', enforcement: 'gated_check', locked: true },
    { name: 'read_only_execution', enforcement: 'read_only', locked: true },
    { name: 'row_limit', enforcement: 'threshold_limit', locked: false, threshold: 1000 },
    { name: 'statement_timeout', enforcement: 'generic', locked: false, threshold: 30 },
  ],
  tools: [{ name: 'query', source: 'mcp:sample/query' }],
  outputBlocks: ['table', 'definition'],
  steps: [
    { name: 'resolve_intent', tier: 'cheap', consumes: [], produces: 'query_intent', realization: 'independent' },
    {
      name: 'generate_sql',
      tier: 'strong',
      consumes: ['query_intent'],
      produces: 'query_result',
      realization: 'independent',
    },
    {
      name: 'repair_sql',
      tier: 'strong',
      consumes: ['query_result'],
      produces: 'repaired_result',
      realization: 'repair_fold',
      guard: 'on_failure',
      foldInto: 'generate_sql',
      maxAttempts: 1,
    },
  ],
  status: 'ready',
});

const generateDashboard: Component = withRealizationLabel({
  id: 'generate_dashboard',
  name: 'Generate Dashboard',
  componentType: 'analytical',
  realizationKind: 'skill',
  trigger: 'one_shot',
  outcome: 'none',
  callableAs: 'generate_dashboard',
  model: 'claude-haiku',
  tiers: [
    { tier: 'strong', model: 'claude-sonnet' },
    { tier: 'cheap', model: 'claude-haiku' },
  ],
  capabilities: [
    { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'genbi_build', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'render_contract', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'artifact_write', outcome: 'realize-via', providedBy: 'runtime', criticality: 'safety-critical' },
    { capability: 'llm:per_step_tier', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:strong', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:cheap', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
  ],
  guardrails: [
    { name: 'artifact_write', enforcement: 'scoped_write', locked: true },
    { name: 'read_only_execution', enforcement: 'read_only', locked: true },
  ],
  tools: [
    { name: 'query', source: 'mcp:sample/query' },
    { name: 'build_dashboard', source: 'mcp:sample/build_dashboard' },
    { name: 'write_artifact', source: 'native' },
  ],
  outputBlocks: ['kpi_card', 'table', 'chart', 'definition'],
  steps: [
    { name: 'plan_dashboard', tier: 'strong', consumes: [], produces: 'dashboard_plan', realization: 'independent' },
    {
      name: 'compose_layout',
      tier: 'cheap',
      consumes: ['dashboard_plan'],
      produces: 'dashboard',
      realization: 'independent',
    },
  ],
  status: 'ready',
});

const explainChange: Component = withRealizationLabel({
  id: 'explain_change',
  name: 'Explain Change',
  componentType: 'analytical',
  realizationKind: 'skill',
  trigger: 'one_shot',
  outcome: 'none',
  callableAs: 'explain_change',
  model: 'claude-sonnet',
  tiers: [{ tier: 'strong', model: 'claude-sonnet' }],
  capabilities: [
    { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'render_contract', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'artifact_write', outcome: 'realize-via', providedBy: 'runtime', criticality: 'safety-critical' },
    { capability: 'llm:strong', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
  ],
  guardrails: [
    { name: 'additivity_guard', enforcement: 'gated_check', locked: true },
    { name: 'artifact_write', enforcement: 'scoped_write', locked: true },
    { name: 'drill_depth_limit', enforcement: 'threshold_limit', locked: false, threshold: 3 },
    { name: 'read_only_execution', enforcement: 'read_only', locked: true },
  ],
  tools: [
    { name: 'query', source: 'mcp:sample/query' },
    { name: 'write_artifact', source: 'native' },
  ],
  outputBlocks: ['narrative'],
  steps: [
    {
      name: 'plan_decomposition',
      tier: 'strong',
      consumes: [],
      produces: 'decomposition_plan',
      realization: 'independent',
    },
    {
      name: 'synthesize_drivers',
      tier: 'strong',
      consumes: ['decomposition_plan'],
      produces: 'driver_explanation',
      realization: 'independent',
    },
  ],
  status: 'ready',
});

/**
 * Synthetic — mirrors the warble hub's `monitor_freshness` component anatomy:
 * `assertive` / `realization_kind: tool` / `trigger: scheduled` / an
 * `assertion` outcome, a single conditional cheap-tier step (only runs on a
 * staleness flag), and its borrowed capabilities (scheduler, read-only SQL,
 * notify channel, cheap LLM). Not part of genbi-default — fixture-only, so
 * the Components table shows the full range of anatomy positions.
 */
const monitorFreshness: Component = withRealizationLabel({
  id: 'monitor_freshness',
  name: 'Monitor Freshness',
  componentType: 'assertive',
  realizationKind: 'tool',
  trigger: 'scheduled',
  outcome: 'assertion',
  callableAs: 'monitor_freshness',
  model: 'claude-haiku',
  tiers: [{ tier: 'cheap', model: 'claude-haiku' }],
  capabilities: [
    { capability: 'scheduler', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
    { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
    { capability: 'notify_channel', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
    { capability: 'llm:cheap', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
  ],
  guardrails: [
    { name: 'read_only_execution', enforcement: 'read_only', locked: true },
    { name: 'alert_routing', enforcement: 'routing', locked: false },
  ],
  tools: [{ name: 'check_freshness', source: 'mcp:sample/check_freshness' }],
  outputBlocks: ['status'],
  steps: [
    {
      name: 'assess_severity',
      tier: 'cheap',
      consumes: ['freshness_reading'],
      produces: 'severity_verdict',
      realization: 'independent',
      guard: 'on_flag',
    },
  ],
  status: 'ready',
});

export const fixtureComponents: Component[] = [
  exploreModel,
  answerQuery,
  generateDashboard,
  explainChange,
  monitorFreshness,
];

/** Capabilities declared across all components, deduped by id in first-seen order — same rule `getHarness` applies live. */
function aggregateCapabilities(components: Component[]): Component['capabilities'] {
  const byId = new Map<string, Component['capabilities'][number]>();
  for (const component of components) {
    for (const cap of component.capabilities) {
      if (!byId.has(cap.capability)) byId.set(cap.capability, cap);
    }
  }
  return Array.from(byId.values());
}

const fixtureAgentProfiles: AgentProfileRow[] = [
  {
    name: fixtureProfile.name,
    role: 'orchestrator',
    tierModel: 'claude-sonnet',
    capabilities: aggregateCapabilities(fixtureComponents),
    status: fixtureProfile.status,
  },
  // Phase-3 placeholder: a spawnable sub-agent profile not yet bindable — greyed in the UI.
  {
    name: 'Forecast Trend',
    role: 'sub-agent',
    tierModel: 'claude-sonnet',
    capabilities: [],
    status: 'Planned (Phase 3)',
  },
];

export const fixtureHarnessView: HarnessView = {
  profile: fixtureProfile,
  runtime: fixtureRuntime,
  connection: fixtureConnection,
  components: fixtureComponents,
  agentProfiles: fixtureAgentProfiles,
};
