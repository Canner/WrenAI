import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';

const navigate = vi.fn();
const client = vi.hoisted(() => ({ readiness: vi.fn(), create: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
vi.mock('@/bff/env', () => ({ isBffEnabled: () => true }));
vi.mock('@/bff/client', () => ({ getNativeSessionReadiness: client.readiness, createNativeSession: client.create, getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }) }));
import { PurposeSessionLaunch } from '../PurposeSessionLaunch';

const ready = {
  runtime: { configured: true, generation: 4, provider: 'claude', target: 'claude-code:interactive', targetLabel: 'Claude CLI' },
  mcp: { server: 'GenBI MCP', tool: 'save_dashboard', destination: 'GenBI Artifacts', available: true },
  purposes: {
    analysis: { scopeKind: 'bound_project', profile: 'genbi-default', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
    setup: { scopeKind: 'bootstrap', profile: 'genbi-setup', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
    context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
  },
} as const;

describe('PurposeSessionLaunch', () => {
  beforeEach(() => { navigate.mockReset(); client.readiness.mockReset().mockResolvedValue(ready); client.create.mockReset(); window.sessionStorage.clear(); });

  it('starts setup through the common session registry and redirects without a model-backed turn', async () => {
    client.create.mockResolvedValue({ session: { id: 'setup-1', status: 'running' }, capability: 'setup-capability', recoveryCapability: 'setup-recovery-capability' });
    renderWithProviders(<PurposeSessionLaunch purpose="setup" title="Setup" lead="lead" returnSource="setup" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start separate Claude CLI session' }));
    expect(client.create).toHaveBeenCalledWith('setup', expect.objectContaining({ intent: 'start_separate', idempotencyKey: expect.any(String) }));
    expect(navigate).toHaveBeenCalledWith('/sessions/setup-1');
    expect(window.sessionStorage.getItem('wren-genbi-native-session-capability:setup-1')).toBe('setup-capability');
    expect(window.sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-1')).toBe('setup-recovery-capability');
    expect(window.sessionStorage.getItem('wren-genbi-native-session-return-source:setup-1')).toBe('setup');
  });

  it('opens a failed Setup launch with its recovery capability but no terminal capability', async () => {
    client.create.mockResolvedValue({ session: { id: 'setup-failed', status: 'failed' }, recoveryCapability: 'setup-recovery-capability' });
    renderWithProviders(<PurposeSessionLaunch purpose="setup" title="Setup" lead="lead" returnSource="setup" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start separate Claude CLI session' }));
    expect(navigate).toHaveBeenCalledWith('/sessions/setup-failed');
    expect(window.sessionStorage.getItem('wren-genbi-native-session-capability:setup-failed')).toBeNull();
    expect(window.sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-failed')).toBe('setup-recovery-capability');
  });

  it('reports the common unavailable state and does not launch', async () => {
    client.readiness.mockResolvedValue({ ...ready, purposes: { ...ready.purposes, context_enrichment: { ...ready.purposes.context_enrichment, available: false, reason: 'native sessions require a current bound project' } } });
    renderWithProviders(<PurposeSessionLaunch purpose="context_enrichment" title="Context" lead="lead" returnSource="context" />);
    await waitFor(() => expect(screen.getByText('native sessions require a current bound project')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Start separate Claude CLI session' })).toBeDisabled();
    expect(client.create).not.toHaveBeenCalled();
  });
});
