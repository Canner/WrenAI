import {
  createReq,
  createRes,
  mockGetWorkspace,
  mockRecordAuditEvent,
  mockSearchAuditEvents,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

describe('platform audit events api route', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/audit-events returns workspace-scoped audit events for platform readers', async () => {
    const handler = (await import('../v1/platform/audit-events/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
      query: { workspaceId: 'workspace-2', preset: 'high-risk' },
    });
    const res = createRes();

    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockSearchAuditEvents.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'role_binding.create',
        actorType: 'user',
        actorId: 'user-2',
        resourceType: 'workspace_member',
        resourceId: 'member-9',
        result: 'allowed',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.workspace).toEqual({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
    });
    expect(res.body.events).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        action: 'role_binding.create',
      }),
    ]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.audit.read',
        payloadJson: {
          workspaceId: 'workspace-2',
          preset: 'high-risk',
        },
      }),
    );
  });
});
