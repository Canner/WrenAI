import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { SetupPage } from '@/setup/SetupPage';
import { useSetupStore } from '@/setup/useSetupStore';
import { ContextPage } from '@/context/ContextPage';
import { useContextStore } from '@/context/useContextStore';

function renderReturned(path: '/setup' | '/context', source: 'setup' | 'context') {
  return render(<ThemeProvider><MemoryRouter initialEntries={[{ pathname: path, state: { nativeSessionReturn: source } }]}>
    <Routes><Route path="/setup" element={<SetupPage />} /><Route path="/context" element={<ContextPage />} /></Routes>
  </MemoryRouter></ThemeProvider>);
}

describe('native session return destinations', () => {
  const setupRefresh = vi.fn(); const setupHydrate = vi.fn();
  const contextRefresh = vi.fn(); const loadOverview = vi.fn(); const loadFiles = vi.fn(); const loadEnrichment = vi.fn();

  beforeEach(() => {
    setupRefresh.mockReset(); setupHydrate.mockReset(); contextRefresh.mockReset(); loadOverview.mockReset(); loadFiles.mockReset(); loadEnrichment.mockReset();
    useSetupStore.setState({ refreshCanonical: setupRefresh, hydrate: setupHydrate }, false);
    useContextStore.setState({ refreshCanonical: contextRefresh, loadOverview, loadFiles, loadEnrichment }, false);
  });

  it('returns to Setup through its canonical refresh path without hydrating a transcript', async () => {
    renderReturned('/setup', 'setup');
    await waitFor(() => expect(setupRefresh).toHaveBeenCalledOnce());
    expect(setupHydrate).not.toHaveBeenCalled();
  });

  it('returns to Context through canonical overview/files/enrichment refresh without a terminal parser', async () => {
    renderReturned('/context', 'context');
    await waitFor(() => expect(contextRefresh).toHaveBeenCalledOnce());
    expect(loadOverview).not.toHaveBeenCalled();
    expect(loadFiles).not.toHaveBeenCalled();
    expect(loadEnrichment).not.toHaveBeenCalled();
  });
});
