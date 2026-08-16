import { createServer } from 'node:http';

const port = 4786;
const now = '2026-08-11T00:00:00.000Z';
const structuredSessions = [
  { id: 'structured-browser-en', title: 'Quarterly revenue retention analysis for enterprise expansion opportunities across every regional sales team', createdAt: now, updatedAt: now },
  { id: 'structured-browser-cjk', title: '跨區域客戶留存與產品採用趨勢分析報告，協助辨識下一季的成長機會', createdAt: now, updatedAt: now },
];

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function nativeSession(purpose = 'analysis', id = 'browser-analysis', status = 'exited') {
  return {
    id, purpose, vendor: 'claude', agent: purpose === 'context_enrichment' ? 'inspect_context' : 'answer_query', scopeKind: 'bound_project',
    scopeId: 'browser-scope', projectIdentity: 'browser-project', bindingGeneration: 1, projectRevision: 'sha256:browser',
    status, createdAt: now, updatedAt: now, startedAt: now, endedAt: status === 'running' ? null : now, exitCode: status === 'running' ? null : 0, failure: null,
  };
}

const nativeSessions = [
  nativeSession('analysis', 'native-session-8b7e2a19', 'running'),
  nativeSession('context_enrichment', 'native-session-08107e3e', 'running'),
  nativeSession('analysis', 'native-session-6a5b4c3d', 'detached'),
  nativeSession('context_enrichment', 'native-session-1234abcd', 'exited'),
  nativeSession('analysis', 'native-session-9876fedc', 'failed'),
];

const artifacts = [
  {
    id: 'browser-artifact-en', sessionId: 'structured-browser-en',
    name: 'Quarterly revenue retention analysis for enterprise expansion opportunities across every regional sales team',
    artifactKind: 'dashboard', location: 'artifacts/browser-artifact-en.json', verified: true, createdAt: now,
    published: { link: 'https://share.genbi.example/browser-artifact-en', scope: 'workspace' },
  },
  {
    id: 'browser-artifact-cjk', sessionId: 'structured-browser-cjk',
    name: '跨區域客戶留存與產品採用趨勢分析報告，協助辨識下一季的成長機會',
    artifactKind: 'report', location: 'artifacts/browser-artifact-cjk.html', verified: true, createdAt: now,
  },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `browser-artifact-${index}`, sessionId: 'structured-browser-en', name: `Artifact history item ${index + 1}`,
    artifactKind: 'chart', location: `artifacts/browser-artifact-${index}.json`, verified: index % 2 === 0, createdAt: now,
  })),
];

const readiness = {
  runtime: { configured: true, generation: 1, provider: 'claude', target: 'claude-code:interactive', targetLabel: 'Claude CLI' },
  purposes: {
    analysis: { scopeKind: 'bound_project', profile: 'genbi-default', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
    setup: { scopeKind: 'bootstrap', profile: 'genbi-setup', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
    context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
  },
};

const server = createServer((request, response) => {
  const { method, url } = request;
  if (method === 'GET' && url === '/health') return respond(response, 200, { ok: true });
  if (method === 'GET' && url === '/api/native-sessions/readiness') return respond(response, 200, readiness);
  if (method === 'GET' && url === '/api/native-sessions') return respond(response, 200, { sessions: nativeSessions });
  if (method === 'GET' && url === '/api/artifacts') return respond(response, 200, artifacts);
  const artifactMatch = url?.match(/^\/api\/artifacts\/([^/]+)(?:\/content)?$/);
  if (method === 'GET' && artifactMatch) {
    if (url.endsWith('/content')) return respond(response, 200, { form: 'unavailable', reason: 'unreadable' });
    const artifact = artifacts.find((item) => item.id === decodeURIComponent(artifactMatch[1]));
    return artifact ? respond(response, 200, artifact) : respond(response, 404, { error: 'Artifact fixture not found' });
  }
  if (method === 'POST' && url === '/api/native-sessions') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const { purpose } = JSON.parse(body || '{}');
      if (purpose !== 'analysis') return respond(response, 400, { error: 'browser fixture accepts analysis only' });
      return respond(response, 200, { session: nativeSession(purpose), capability: 'browser-capability' });
    });
    return;
  }
  if (method === 'GET' && url === '/api/sessions') return respond(response, 200, structuredSessions);
  if (method === 'POST' && url === '/api/sessions') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const { title } = JSON.parse(body || '{}');
      const session = {
        id: `browser-structured-${structuredSessions.length + 1}`,
        title: typeof title === 'string' && title.trim() ? title : 'New session',
        createdAt: now,
        updatedAt: now,
      };
      structuredSessions.unshift(session);
      return respond(response, 201, session);
    });
    return;
  }
  return respond(response, 404, { error: `Unhandled browser fixture route: ${method} ${url}` });
});

server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
