import crypto from 'crypto';
import {
  AuthIdentity,
  IAuthIdentityRepository,
  IIdentityProviderConfigRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IdentityProviderConfig,
  User,
  WorkspaceMember,
} from '@server/repositories';
import {
  DirectoryGroupWithMembers,
  IGovernanceService,
} from './governanceService';
import { IWorkspaceService } from './workspaceService';

type ProviderConfigJson = {
  scimBearerToken?: string;
  groupRoleMappings?: Array<{ group: string; roleKey: string }>;
};

export interface ScimContext {
  workspace: {
    id: string;
    slug?: string | null;
    name: string;
  };
  provider: IdentityProviderConfig;
}

export interface IScimService {
  authenticate(input: {
    workspaceSlug: string;
    bearerToken: string;
  }): Promise<ScimContext>;
  listUsers(context: ScimContext): Promise<any[]>;
  getUser(context: ScimContext, id: string): Promise<any | null>;
  createUser(context: ScimContext, payload: Record<string, any>): Promise<any>;
  replaceUser(
    context: ScimContext,
    id: string,
    payload: Record<string, any>,
  ): Promise<any>;
  patchUser(
    context: ScimContext,
    id: string,
    operations: Array<Record<string, any>>,
  ): Promise<any>;
  deleteUser(context: ScimContext, id: string): Promise<void>;
  listGroups(context: ScimContext): Promise<any[]>;
  getGroup(context: ScimContext, id: string): Promise<any | null>;
  createGroup(context: ScimContext, payload: Record<string, any>): Promise<any>;
  replaceGroup(
    context: ScimContext,
    id: string,
    payload: Record<string, any>,
  ): Promise<any>;
  patchGroup(
    context: ScimContext,
    id: string,
    operations: Array<Record<string, any>>,
  ): Promise<any>;
  deleteGroup(context: ScimContext, id: string): Promise<void>;
}

const getPrimaryEmail = (payload: Record<string, any>) => {
  const emails = Array.isArray(payload.emails) ? payload.emails : [];
  const primary =
    emails.find((item) => item?.primary && typeof item.value === 'string') ||
    emails.find((item) => typeof item?.value === 'string');
  if (primary?.value) {
    return String(primary.value).trim().toLowerCase();
  }
  if (typeof payload.email === 'string') {
    return payload.email.trim().toLowerCase();
  }
  return null;
};

const getDisplayName = (payload: Record<string, any>) => {
  if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
    return payload.displayName.trim();
  }
  if (payload.name && typeof payload.name === 'object') {
    const given =
      typeof payload.name.givenName === 'string'
        ? payload.name.givenName.trim()
        : '';
    const family =
      typeof payload.name.familyName === 'string'
        ? payload.name.familyName.trim()
        : '';
    const full = `${given} ${family}`.trim();
    if (full) {
      return full;
    }
  }
  if (typeof payload.userName === 'string' && payload.userName.trim()) {
    return payload.userName.trim();
  }
  return 'SCIM User';
};

const normalizeGroupMappings = (provider: IdentityProviderConfig) => {
  const config = (provider.configJson || {}) as ProviderConfigJson;
  const mappings = Array.isArray(config.groupRoleMappings)
    ? config.groupRoleMappings
    : [];
  return mappings
    .filter((item) => item?.group && item?.roleKey)
    .map((item) => ({
      group: String(item.group).trim(),
      roleKey: String(item.roleKey).trim().toLowerCase(),
    }));
};

const buildScimProviderSubject = (
  providerId: string,
  externalSubject: string,
) => `scim:${providerId}:${externalSubject}`;

const getStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item?.value || item || '').trim())
        .filter(Boolean)
    : [];

export class ScimService implements IScimService {
  constructor(
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly identityProviderConfigRepository: IIdentityProviderConfigRepository,
    private readonly userRepository: IUserRepository,
    private readonly authIdentityRepository: IAuthIdentityRepository,
    private readonly workspaceMemberRepository: IWorkspaceMemberRepository,
    private readonly workspaceService: IWorkspaceService,
    private readonly governanceService: IGovernanceService,
  ) {}

  public async authenticate(input: {
    workspaceSlug: string;
    bearerToken: string;
  }) {
    const workspace = await this.workspaceRepository.findOneBy({
      slug: input.workspaceSlug,
    });
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const providers = await this.identityProviderConfigRepository.findAllBy({
      workspaceId: workspace.id,
      enabled: true,
    });
    const provider = providers.find((candidate) => {
      const config = (candidate.configJson || {}) as ProviderConfigJson;
      return (
        config.scimBearerToken && config.scimBearerToken === input.bearerToken
      );
    });

    if (!provider) {
      throw new Error('Invalid SCIM token');
    }

    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug || null,
        name: workspace.name,
      },
      provider,
    };
  }

  public async listUsers(context: ScimContext) {
    const memberships = await this.workspaceMemberRepository.findAllBy(
      { workspaceId: context.workspace.id },
      { order: 'created_at asc' },
    );
    const users = await Promise.all(
      memberships.map((membership) =>
        this.userRepository.findOneBy({ id: membership.userId }),
      ),
    );

    return memberships
      .map((membership, index) =>
        users[index] ? this.toScimUser(users[index]!, membership) : null,
      )
      .filter(Boolean);
  }

  public async getUser(context: ScimContext, id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      return null;
    }
    const membership = await this.workspaceService.getMembership(
      context.workspace.id,
      user.id,
    );
    if (!membership) {
      return null;
    }
    return this.toScimUser(user, membership);
  }

  public async createUser(context: ScimContext, payload: Record<string, any>) {
    return await this.upsertUser(context, payload);
  }

  public async replaceUser(
    context: ScimContext,
    id: string,
    payload: Record<string, any>,
  ) {
    return await this.upsertUser(context, { ...payload, id });
  }

  public async patchUser(
    context: ScimContext,
    id: string,
    operations: Array<Record<string, any>>,
  ) {
    const existing = await this.getUser(context, id);
    if (!existing) {
      throw new Error('User not found');
    }

    const nextPayload: Record<string, any> = {
      id,
      userName: existing.userName,
      displayName: existing.displayName,
      emails: existing.emails,
      active: existing.active,
      externalId: existing.externalId,
    };

    for (const operation of operations || []) {
      const path = String(operation.path || '').trim();
      const op = String(operation.op || '')
        .trim()
        .toLowerCase();
      if (op === 'replace' || op === 'add') {
        if (!path || path === 'active') {
          if (
            operation.value &&
            typeof operation.value === 'object' &&
            'active' in operation.value
          ) {
            nextPayload.active = Boolean(operation.value.active);
          } else {
            nextPayload.active = Boolean(operation.value);
          }
        }
        if (path === 'displayName') {
          nextPayload.displayName = String(operation.value || '').trim();
        }
        if (path === 'userName') {
          nextPayload.userName = String(operation.value || '').trim();
        }
        if (path === 'emails') {
          nextPayload.emails = Array.isArray(operation.value)
            ? operation.value
            : [];
        }
      }
    }

    return await this.upsertUser(context, nextPayload);
  }

  public async deleteUser(context: ScimContext, id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      return;
    }

    const membership = await this.workspaceService.getMembership(
      context.workspace.id,
      id,
    );
    if (membership) {
      await this.workspaceService.updateMember({
        workspaceId: context.workspace.id,
        memberId: membership.id,
        status: 'inactive',
      });
    }

    await this.syncGlobalUserStatus(id);
  }

  public async listGroups(context: ScimContext) {
    const groups = await this.governanceService.listDirectoryGroups(
      context.workspace.id,
    );
    return groups.map((group) => this.toScimGroup(group));
  }

  public async getGroup(context: ScimContext, id: string) {
    const groups = await this.governanceService.listDirectoryGroups(
      context.workspace.id,
    );
    const group = groups.find((item) => item.id === id);
    return group ? this.toScimGroup(group) : null;
  }

  public async createGroup(context: ScimContext, payload: Record<string, any>) {
    return await this.upsertGroup(context, payload);
  }

  public async replaceGroup(
    context: ScimContext,
    id: string,
    payload: Record<string, any>,
  ) {
    return await this.upsertGroup(context, { ...payload, id });
  }

  public async patchGroup(
    context: ScimContext,
    id: string,
    operations: Array<Record<string, any>>,
  ) {
    const existing = await this.getGroup(context, id);
    if (!existing) {
      throw new Error('Group not found');
    }

    let memberIds = getStringArray(existing.members);
    let displayName = String(existing.displayName || '').trim();
    for (const operation of operations || []) {
      const path = String(operation.path || '').trim();
      const op = String(operation.op || '')
        .trim()
        .toLowerCase();
      if ((op === 'replace' || op === 'add') && path === 'displayName') {
        displayName = String(operation.value || '').trim() || displayName;
      }
      if ((op === 'replace' || op === 'add') && (!path || path === 'members')) {
        memberIds = getStringArray(operation.value);
      }
      if (op === 'remove' && path === 'members') {
        const removed = new Set(getStringArray(operation.value));
        memberIds = memberIds.filter((memberId) => !removed.has(memberId));
      }
    }

    return await this.upsertGroup(context, {
      id,
      displayName,
      members: memberIds.map((memberId) => ({ value: memberId })),
      externalId: existing.externalId,
    });
  }

  public async deleteGroup(context: ScimContext, id: string) {
    await this.governanceService.deleteDirectoryGroup(context.workspace.id, id);
  }

  private async upsertUser(context: ScimContext, payload: Record<string, any>) {
    const email = getPrimaryEmail(payload);
    const externalSubject =
      (typeof payload.externalId === 'string' && payload.externalId.trim()) ||
      (typeof payload.userName === 'string' && payload.userName.trim()) ||
      email;
    if (!externalSubject) {
      throw new Error('SCIM user must include externalId, userName, or email');
    }

    const providerSubject = buildScimProviderSubject(
      context.provider.id,
      externalSubject,
    );
    let identity =
      (await this.authIdentityRepository.findOneBy({
        identityProviderConfigId: context.provider.id,
        externalSubject,
      })) ||
      (await this.authIdentityRepository.findOneBy({
        providerType: 'scim',
        providerSubject,
      }));

    let user: User | null = null;
    if (identity) {
      user = await this.userRepository.findOneBy({ id: identity.userId });
    }
    if (!user && email) {
      user = await this.userRepository.findOneBy({ email });
    }

    if (!user) {
      user = await this.userRepository.createOne({
        id: crypto.randomUUID(),
        email: email || `${externalSubject}@scim.local`,
        displayName: getDisplayName(payload),
        status: Boolean(payload.active ?? true) ? 'active' : 'inactive',
        defaultWorkspaceId: context.workspace.id,
      });
    } else {
      user = await this.userRepository.updateOne(user.id, {
        email: email || user.email,
        displayName: getDisplayName(payload) || user.displayName,
        status: Boolean(payload.active ?? true) ? 'active' : user.status,
      });
    }

    if (!identity) {
      identity = await this.authIdentityRepository.createOne({
        id: crypto.randomUUID(),
        userId: user.id,
        providerType: 'scim',
        providerSubject,
        identityProviderConfigId: context.provider.id,
        externalSubject,
        metadata: {
          source: 'scim',
        },
      });
    } else {
      identity = await this.authIdentityRepository.updateOne(identity.id, {
        userId: user.id,
        providerType: 'scim',
        providerSubject,
        identityProviderConfigId: context.provider.id,
        externalSubject,
      });
    }

    const membership = await this.workspaceService.addMember({
      workspaceId: context.workspace.id,
      userId: user.id,
      roleKey: 'member',
      status: Boolean(payload.active ?? true) ? 'active' : 'inactive',
    });

    await this.syncGlobalUserStatus(user.id);
    return this.toScimUser(user, membership, identity);
  }

  private async upsertGroup(
    context: ScimContext,
    payload: Record<string, any>,
  ) {
    const displayName = String(payload.displayName || '').trim();
    if (!displayName) {
      throw new Error('SCIM group displayName is required');
    }
    const externalId =
      typeof payload.externalId === 'string' && payload.externalId.trim()
        ? payload.externalId.trim()
        : null;
    const memberRefs = Array.isArray(payload.members) ? payload.members : [];
    const memberIds = await this.resolveGroupMemberIds(context, memberRefs);
    const roleKey = this.resolveMappedRoleKey(
      context.provider,
      externalId || displayName,
      displayName,
    );

    const group = await this.governanceService.upsertIdentityDirectoryGroup({
      workspaceId: context.workspace.id,
      identityProviderConfigId: context.provider.id,
      externalId,
      displayName,
      roleKey,
      memberIds,
      source: 'scim',
      metadata: {
        schemas: payload.schemas || [],
      },
    });

    return this.toScimGroup(group);
  }

  private async resolveGroupMemberIds(
    context: ScimContext,
    members: Array<Record<string, any>>,
  ) {
    const result: string[] = [];
    for (const member of members || []) {
      const value = String(member?.value || '').trim();
      if (!value) {
        continue;
      }
      const user =
        (await this.userRepository.findOneBy({ id: value })) ||
        (await this.userRepository.findOneBy({ email: value.toLowerCase() }));
      if (!user) {
        continue;
      }
      const membership = await this.workspaceService.getMembership(
        context.workspace.id,
        user.id,
      );
      if (membership?.status === 'active') {
        result.push(user.id);
      }
    }

    return Array.from(new Set(result));
  }

  private resolveMappedRoleKey(
    provider: IdentityProviderConfig,
    externalId: string,
    displayName: string,
  ) {
    const mappings = normalizeGroupMappings(provider);
    const matched = mappings.find(
      (mapping) =>
        mapping.group === displayName || mapping.group === externalId,
    );
    return matched?.roleKey || null;
  }

  private async syncGlobalUserStatus(userId: string) {
    const memberships = await this.workspaceMemberRepository.findAllBy({
      userId,
    });
    const hasActiveMembership = memberships.some(
      (membership) => membership.status === 'active',
    );
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      return;
    }

    const nextStatus = hasActiveMembership ? 'active' : 'inactive';
    if (user.status !== nextStatus) {
      await this.userRepository.updateOne(user.id, { status: nextStatus });
    }
  }

  private toScimUser(
    user: User,
    membership: WorkspaceMember,
    identity?: AuthIdentity | null,
  ) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      externalId: identity?.externalSubject || null,
      userName: user.email,
      displayName: user.displayName,
      active: membership.status === 'active',
      emails: user.email
        ? [
            {
              value: user.email,
              primary: true,
            },
          ]
        : [],
      meta: {
        resourceType: 'User',
        created: user.createdAt || null,
        lastModified: user.updatedAt || null,
      },
    };
  }

  private toScimGroup(group: DirectoryGroupWithMembers) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: group.id,
      externalId: group.externalId || null,
      displayName: group.displayName,
      members: group.members.map((member) => ({ value: member.userId })),
      meta: {
        resourceType: 'Group',
        created: group.createdAt || null,
        lastModified: group.updatedAt || null,
      },
    };
  }
}
