export {};

const mockAuthenticate = jest.fn();
const mockListUsers = jest.fn();
const mockCreateUser = jest.fn();
const mockPatchUser = jest.fn();
const mockDeleteUser = jest.fn();
const mockListGroups = jest.fn();
const mockCreateGroup = jest.fn();
const mockPatchGroup = jest.fn();
const mockDeleteGroup = jest.fn();
const mockCreateAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    scimService: {
      authenticate: mockAuthenticate,
      listUsers: mockListUsers,
      createUser: mockCreateUser,
      patchUser: mockPatchUser,
      deleteUser: mockDeleteUser,
      listGroups: mockListGroups,
      createGroup: mockCreateGroup,
      patchGroup: mockPatchGroup,
      deleteGroup: mockDeleteGroup,
      getUser: jest.fn(),
      replaceUser: jest.fn(),
      getGroup: jest.fn(),
      replaceGroup: jest.fn(),
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

describe('SCIM api routes', () => {
  const scimContext = {
    workspace: {
      id: 'workspace-1',
      slug: 'demo-workspace',
      name: 'Demo Workspace',
    },
    provider: {
      id: 'idp-1',
    },
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      body: {},
      query: {},
      headers: {
        authorization: 'Bearer scim-token',
      },
      ...overrides,
    }) as any;

  const createRes = () => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader: jest.fn(),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((payload: any) => {
        res.body = payload;
        return res;
      }),
      end: jest.fn(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue(scimContext);
  });

  it('lists SCIM users', async () => {
    const handler = (await import('../scim/v2/[workspaceSlug]/Users/index'))
      .default;
    const req = createReq({
      method: 'GET',
      query: { workspaceSlug: 'demo-workspace' },
    });
    const res = createRes();

    mockListUsers.mockResolvedValue([
      { id: 'user-1', userName: 'owner@example.com' },
      { id: 'user-2', userName: 'member@example.com' },
    ]);

    await handler(req, res);

    expect(mockAuthenticate).toHaveBeenCalledWith({
      workspaceSlug: 'demo-workspace',
      bearerToken: 'scim-token',
    });
    expect(mockListUsers).toHaveBeenCalledWith(scimContext);
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_provider.read',
        result: 'allowed',
        workspaceId: 'workspace-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        { id: 'user-1', userName: 'owner@example.com' },
        { id: 'user-2', userName: 'member@example.com' },
      ],
    });
  });

  it('creates a SCIM user', async () => {
    const handler = (await import('../scim/v2/[workspaceSlug]/Users/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceSlug: 'demo-workspace' },
      body: {
        userName: 'member@example.com',
        name: {
          givenName: 'Member',
        },
      },
    });
    const res = createRes();

    mockCreateUser.mockResolvedValue({
      id: 'user-2',
      userName: 'member@example.com',
      active: true,
    });

    await handler(req, res);

    expect(mockCreateUser).toHaveBeenCalledWith(scimContext, {
      userName: 'member@example.com',
      name: {
        givenName: 'Member',
      },
    });
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_provider.manage',
        result: 'succeeded',
        workspaceId: 'workspace-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      id: 'user-2',
      userName: 'member@example.com',
      active: true,
    });
  });

  it('patches a SCIM group', async () => {
    const handler = (await import('../scim/v2/[workspaceSlug]/Groups/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { workspaceSlug: 'demo-workspace', id: 'group-1' },
      body: {
        Operations: [
          {
            op: 'replace',
            path: 'displayName',
            value: 'Finance Admins',
          },
        ],
      },
    });
    const res = createRes();

    mockPatchGroup.mockResolvedValue({
      id: 'group-1',
      displayName: 'Finance Admins',
      members: [],
    });

    await handler(req, res);

    expect(mockPatchGroup).toHaveBeenCalledWith(scimContext, 'group-1', [
      {
        op: 'replace',
        path: 'displayName',
        value: 'Finance Admins',
      },
    ]);
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_provider.manage',
        result: 'succeeded',
        workspaceId: 'workspace-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      id: 'group-1',
      displayName: 'Finance Admins',
      members: [],
    });
  });

  it('deletes a SCIM user', async () => {
    const handler = (await import('../scim/v2/[workspaceSlug]/Users/[id]'))
      .default;
    const req = createReq({
      method: 'DELETE',
      query: { workspaceSlug: 'demo-workspace', id: 'user-2' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockDeleteUser).toHaveBeenCalledWith(scimContext, 'user-2');
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'identity_provider.manage',
        result: 'succeeded',
        workspaceId: 'workspace-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
