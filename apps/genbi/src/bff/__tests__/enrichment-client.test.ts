import { afterEach, describe, expect, it, vi } from 'vitest';
import { postEnrichmentEdit, postEnrichmentReapply, postEnrichmentRetry } from '../client';

describe('enrichment recovery client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the current expectedVersion for retry and explicit reapply', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await postEnrichmentRetry('run-1', 7);
    await postEnrichmentReapply('run-1', 'op-1', 8);
    expect(fetch.mock.calls[0]?.[0]).toContain('/api/context/enrichment/run-1/retry');
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ expectedVersion: 7 }));
    expect(fetch.mock.calls[1]?.[0]).toContain('/api/context/enrichment/run-1/reapply');
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ operationId: 'op-1', expectedVersion: 8 }));
  });

  it('sends only bounded edit fields and the version to the edit endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await postEnrichmentEdit('run-1', 'op-1', { sink: 'knowledge/glossary.md', changeKind: 'knowledge_append', summary: 'Add a term', draft: 'Term: margin' }, 9);
    expect(fetch.mock.calls[0]?.[0]).toContain('/api/context/enrichment/run-1/edit');
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ operationId: 'op-1', sink: 'knowledge/glossary.md', changeKind: 'knowledge_append', summary: 'Add a term', draft: 'Term: margin', expectedVersion: 9 }));
  });
});
