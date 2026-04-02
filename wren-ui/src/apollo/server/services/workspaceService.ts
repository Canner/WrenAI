import crypto from 'crypto';
import {
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IUserRepository,
  Workspace,
  WorkspaceMember,
} from '../repositories';

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  settings?: Record<string, any>;
  createdBy?: string;
}

export interface AddWorkspaceMemberInput {
  workspaceId: string;
  userId: string;
  roleKey?: string;
  status?: string;
}

export interface IWorkspaceService {
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceById(workspaceId: string): Promise<Workspace | null>;
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  addMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMember>;
  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null>;
}

export class WorkspaceService implements IWorkspaceService {
  private workspaceRepository: IWorkspaceRepository;
  private workspaceMemberRepository: IWorkspaceMemberRepository;
  private userRepository: IUserRepository;

  constructor({
    workspaceRepository,
    workspaceMemberRepository,
    userRepository,
  }: {
    workspaceRepository: IWorkspaceRepository;
    workspaceMemberRepository: IWorkspaceMemberRepository;
    userRepository: IUserRepository;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.userRepository = userRepository;
  }

  public async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return await this.workspaceRepository.createOne({
      id: crypto.randomUUID(),
      name: input.name,
      slug: await this.ensureUniqueSlug(input.slug || input.name),
      settings: input.settings || null,
      createdBy: input.createdBy,
      status: 'active',
    });
  }

  public async getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
    return await this.workspaceRepository.findOneBy({ id: workspaceId });
  }

  public async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.workspaceMemberRepository.findAllBy({
      userId,
      status: 'active',
    });

    const workspaces = await Promise.all(
      memberships.map((membership) =>
        this.workspaceRepository.findOneBy({ id: membership.workspaceId }),
      ),
    );

    return workspaces.filter(Boolean);
  }

  public async addMember(
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    const user = await this.userRepository.findOneBy({ id: input.userId });
    if (!user) {
      throw new Error(`User ${input.userId} not found`);
    }

    const workspace = await this.workspaceRepository.findOneBy({
      id: input.workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceId} not found`);
    }

    const existingMembership = await this.workspaceMemberRepository.findOneBy({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
    if (existingMembership) {
      return existingMembership;
    }

    return await this.workspaceMemberRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleKey: input.roleKey || 'member',
      status: input.status || 'active',
    });
  }

  public async getMembership(workspaceId: string, userId: string) {
    return await this.workspaceMemberRepository.findOneBy({
      workspaceId,
      userId,
    });
  }

  private async ensureUniqueSlug(candidate: string) {
    const baseSlug = candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';

    let slug = baseSlug;
    let suffix = 2;
    while (await this.workspaceRepository.findOneBy({ slug })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }
}
