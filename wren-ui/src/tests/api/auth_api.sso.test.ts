import {
  createReq,
  createRes,
  mockCompleteWorkspaceSSO,
  mockFindSsoSession,
  mockListKbSnapshots,
  mockListKnowledgeBases,
  mockStartWorkspaceSSO,
} from './auth_api.testSupport';
import { resetAuthApiMocks } from './auth_api.testSupport';

describe('pages/api/auth routes', () => {
  beforeEach(() => {
    resetAuthApiMocks();
  });

  it('restores redirectTo after enterprise SSO callback', async () => {
    const handler = (await import('../../pages/api/auth/sso/callback')).default;
    const req = createReq({
      method: 'GET',
      query: {
        state: 'state-1',
        code: 'code-1',
      },
      headers: {
        host: 'localhost:3000',
      },
    });
    const res = createRes();

    mockFindSsoSession.mockResolvedValue({
      id: 'sso-session-1',
      state: 'state-1',
      redirectTo: '/workspace?tab=members',
    });
    mockCompleteWorkspaceSSO.mockResolvedValue({
      sessionToken: 'sso-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo',
      },
      membership: {
        id: 'member-1',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);
    mockListKbSnapshots.mockReset();
    mockListKbSnapshots.mockResolvedValue([]);

    await handler(req, res);

    expect(mockCompleteWorkspaceSSO).toHaveBeenCalledWith({
      state: 'state-1',
      relayState: 'state-1',
      code: 'code-1',
      samlResponse: undefined,
      origin: 'http://localhost:3000',
    });
    expect(res.getHeader('Set-Cookie')).toContain('wren_session=sso-token');
    expect(res.writeHead).toHaveBeenCalledWith(302, {
      Location:
        '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-a',
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('supports SAML POST callback with RelayState', async () => {
    const handler = (await import('../../pages/api/auth/sso/callback')).default;
    const req = createReq({
      method: 'POST',
      body: {
        RelayState: 'state-saml',
        SAMLResponse: 'encoded-saml-response',
      },
      headers: {
        host: 'localhost:3000',
      },
    });
    const res = createRes();

    mockFindSsoSession.mockResolvedValue({
      id: 'sso-session-2',
      state: 'state-saml',
      redirectTo: '/workspace?tab=members',
    });
    mockCompleteWorkspaceSSO.mockResolvedValue({
      sessionToken: 'saml-sso-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo',
      },
      membership: {
        id: 'member-1',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockCompleteWorkspaceSSO).toHaveBeenCalledWith({
      state: 'state-saml',
      relayState: 'state-saml',
      code: undefined,
      samlResponse: 'encoded-saml-response',
      origin: 'http://localhost:3000',
    });
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=saml-sso-token',
    );
    expect(res.writeHead).toHaveBeenCalledWith(302, {
      Location:
        '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-a',
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('starts enterprise SSO with workspace slug and redirectTo', async () => {
    const handler = (await import('../../pages/api/auth/sso/start')).default;
    const req = createReq({
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'user-agent': 'jest',
        'x-forwarded-for': '127.0.0.1',
      },
      body: {
        workspaceSlug: 'demo-workspace',
        redirectTo: '/workspace?tab=members',
      },
    });
    const res = createRes();

    mockStartWorkspaceSSO.mockResolvedValue({
      authorizeUrl: 'https://idp.example.com/authorize',
    });

    await handler(req, res);

    expect(mockStartWorkspaceSSO).toHaveBeenCalledWith({
      workspaceSlug: 'demo-workspace',
      origin: 'http://localhost:3000',
      redirectTo: '/workspace?tab=members',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      authorizeUrl: 'https://idp.example.com/authorize',
    });
  });
});

export {};
