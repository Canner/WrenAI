import { WorkspaceService } from '../workspaceService';

describe('WorkspaceService', () => {
  let workspaceRepository: any;
  let workspaceMemberRepository: any;
  let userRepository: any;
  let service: WorkspaceService;

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
    };
    workspaceMemberRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
    };
    userRepository = {
      findOneBy: jest.fn(),
    };

    service = new WorkspaceService({
      workspaceRepository,
      workspaceMemberRepository,
      userRepository,
    });
  });

  it('creates workspace with generated unique slug', async () => {
    workspaceRepository.findOneBy
      .mockResolvedValueOnce({ id: 'existing', slug: 'demo' })
      .mockResolvedValueOnce(null);
    workspaceRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));

    const result = await service.createWorkspace({ name: 'Demo' });

    expect(result.slug).toBe('demo-2');
    expect(result.status).toBe('active');
  });

  it('lists active workspaces for a user', async () => {
    workspaceMemberRepository.findAllBy.mockResolvedValue([
      { workspaceId: 'workspace-1', userId: 'user-1', status: 'active' },
      { workspaceId: 'workspace-2', userId: 'user-1', status: 'active' },
    ]);
    workspaceRepository.findOneBy
      .mockResolvedValueOnce({ id: 'workspace-1', name: 'A' })
      .mockResolvedValueOnce({ id: 'workspace-2', name: 'B' });

    const result = await service.listWorkspacesForUser('user-1');

    expect(result).toHaveLength(2);
    expect(result.map((workspace) => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
  });
});
