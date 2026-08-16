import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';

const navigate = vi.fn();
const client = vi.hoisted(() => ({ readiness: vi.fn(), create: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
vi.mock('@/bff/env', () => ({ isBffEnabled: () => true }));
vi.mock('@/bff/client', () => ({ getNativeSessionReadiness: client.readiness, createNativeSession: client.create, getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }) }));
import { EnrichmentPanel } from '../EnrichmentPanel';

describe('EnrichmentPanel', () => {
  beforeEach(() => {
    navigate.mockReset(); window.sessionStorage.clear();
    client.readiness.mockReset().mockResolvedValue({ runtime: { configured: true, generation: 7, provider: 'codex', target: 'codex:interactive', targetLabel: 'Codex CLI' }, purposes: { context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'codex:interactive', targetLabel: 'Codex CLI', available: true } } });
    client.create.mockReset().mockResolvedValue({ session: { id: 'enrich-1', purpose: 'context_enrichment', vendor: 'codex', status: 'running', agent: 'genbi-enrich-context', scopeKind: 'bound_project', scopeId: 'scope-1', projectIdentity: 'bound', bindingGeneration: 7, projectRevision: 'sha256:bound', createdAt: '', updatedAt: '' }, capability: 'capability-1' });
  });

  it('offers Sessions continuation instead of Grill/Auto-pilot review controls', async () => {
    renderWithProviders(<EnrichmentPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start separate Codex CLI session' })).toBeEnabled());
    expect(screen.getAllByRole('button', { name: /Start separate .*CLI session/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Start Grill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Auto-pilot' })).not.toBeInTheDocument();
  });

  it('creates the fixed enrichment purpose and enters the shared workbench', async () => {
    renderWithProviders(<EnrichmentPanel />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start separate Codex CLI session' }));
    expect(client.create).toHaveBeenCalledWith('context_enrichment', expect.objectContaining({ intent: 'start_separate', idempotencyKey: expect.any(String) }));
    expect(navigate).toHaveBeenCalledWith('/sessions/enrich-1');
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/context/terminal/'));
  });

  it('shows the common unavailable state without creating a model-backed turn', async () => {
    client.readiness.mockResolvedValue({ runtime: { configured: true, generation: 7, provider: 'codex', target: 'codex:interactive', targetLabel: 'Codex CLI' }, purposes: { context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'codex:interactive', targetLabel: 'Codex CLI', available: false, reason: 'native sessions require a current bound project' } } });
    renderWithProviders(<EnrichmentPanel />);
    expect(await screen.findAllByText('native sessions require a current bound project')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start separate Codex CLI session' })).toBeDisabled();
    expect(client.create).not.toHaveBeenCalled();
  });
});
