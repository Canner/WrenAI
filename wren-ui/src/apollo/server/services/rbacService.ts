import { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  AcceptInvitationInput,
  BootstrapAdminInput,
  CreateRoleInput,
  CreateUserInput,
  InviteMemberInput,
  LoginInput,
  UpdateMemberInput,
  UpdateMemberRoleInput,
  UpdateRoleInput,
  UpdateUserInput,
  UpdateUserRolesInput,
  UserRoleInput,
} from '@server/models';
import {
  IRoleRepository,
  IUserRepository,
  IUserRoleRepository,
  IOrganizationRepository,
  IOrganizationMemberRepository,
  IMemberInvitationRepository,
  IAuthSessionRepository,
  AuthSession,
  MemberInvitation,
  MemberInvitationMapping,
  Organization,
  OrganizationMemberMapping,
  RbacUser,
  Role,
  UserRole,
  UserRoleMapping,
} from '@server/repositories';

export interface RbacUserWithRoles extends RbacUser {
  roles: Role[];
}

export interface RoleWithUsers extends Role {
  users: RbacUser[];
}

export interface IRbacService {
  getBootstrapStatus(): Promise<{ required: boolean }>;
  bootstrapAdmin(input: BootstrapAdminInput): Promise<AuthSessionResult>;
  login(input: LoginInput): Promise<AuthSessionResult>;
  logout(token: string): Promise<boolean>;
  getSession(token?: string | null): Promise<AuthSessionResult | null>;
  listRoles(): Promise<RoleWithUsers[]>;
  createRole(input: CreateRoleInput, actor?: AuthActor | null): Promise<Role>;
  updateRole(input: UpdateRoleInput, actor?: AuthActor | null): Promise<Role>;
  listUsers(): Promise<RbacUserWithRoles[]>;
  createUser(input: CreateUserInput): Promise<RbacUser>;
  updateUser(input: UpdateUserInput): Promise<RbacUser>;
  assignRoleToUser(input: UserRoleInput): Promise<UserRole>;
  updateUserRoles(input: UpdateUserRolesInput): Promise<RbacUserWithRoles>;
  removeRoleFromUser(input: UserRoleInput): Promise<boolean>;
  getUserRoleMappings(): Promise<UserRoleMapping[]>;
  listOrganizations(): Promise<Organization[]>;
  listMembers(actor?: AuthActor | null): Promise<OrganizationMemberMapping[]>;
  listInvitations(actor?: AuthActor | null): Promise<MemberInvitationMapping[]>;
  inviteMember(
    input: InviteMemberInput,
    actor?: AuthActor | null,
  ): Promise<MemberInvitation>;
  acceptInvitation(input: AcceptInvitationInput): Promise<AuthSessionResult>;
  updateMember(
    input: UpdateMemberInput,
    actor?: AuthActor | null,
  ): Promise<OrganizationMemberMapping>;
  updateMemberRole(
    input: UpdateMemberRoleInput,
    actor?: AuthActor | null,
  ): Promise<OrganizationMemberMapping>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_ROLE_NAME = 'Admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface AuthActor {
  user: RbacUser;
  member: OrganizationMemberMapping;
  organization: Organization;
  role: Role;
}

export interface AuthSessionResult extends AuthActor {
  session: AuthSession;
}

export class RbacService implements IRbacService {
  private readonly roleRepository: IRoleRepository;
  private readonly userRepository: IUserRepository;
  private readonly userRoleRepository: IUserRoleRepository;
  private readonly organizationRepository: IOrganizationRepository;
  private readonly organizationMemberRepository: IOrganizationMemberRepository;
  private readonly memberInvitationRepository: IMemberInvitationRepository;
  private readonly authSessionRepository: IAuthSessionRepository;

  constructor({
    roleRepository,
    userRepository,
    userRoleRepository,
    organizationRepository,
    organizationMemberRepository,
    memberInvitationRepository,
    authSessionRepository,
  }: {
    roleRepository: IRoleRepository;
    userRepository: IUserRepository;
    userRoleRepository: IUserRoleRepository;
    organizationRepository: IOrganizationRepository;
    organizationMemberRepository: IOrganizationMemberRepository;
    memberInvitationRepository: IMemberInvitationRepository;
    authSessionRepository: IAuthSessionRepository;
  }) {
    this.roleRepository = roleRepository;
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
    this.organizationRepository = organizationRepository;
    this.organizationMemberRepository = organizationMemberRepository;
    this.memberInvitationRepository = memberInvitationRepository;
    this.authSessionRepository = authSessionRepository;
  }

  public async getBootstrapStatus(): Promise<{ required: boolean }> {
    const adminRole = await this.roleRepository.findOneBy({
      name: ADMIN_ROLE_NAME,
    });
    if (!adminRole) return { required: true };

    const activeMembers =
      await this.organizationMemberRepository.findMappings();
    return {
      required: !activeMembers.some(
        (member) =>
          member.status === 'active' && member.role.name === ADMIN_ROLE_NAME,
      ),
    };
  }

  public async bootstrapAdmin(
    input: BootstrapAdminInput,
  ): Promise<AuthSessionResult> {
    const status = await this.getBootstrapStatus();
    if (!status.required) {
      throw new Error('An Admin member already exists.');
    }

    const name = this.validateRequiredText(input.name, 'Name');
    const email = this.validateEmail(input.email);
    const passwordHash = await this.hashPassword(input.password);
    const role = await this.getRoleByNameOrThrow(ADMIN_ROLE_NAME);
    const organizationName = this.validateRequiredText(
      input.organizationName,
      'Organization name',
    );
    const now = new Date().toISOString();
    const tx = await this.userRepository.transaction();

    try {
      const organization = await this.organizationRepository.createOne(
        {
          name: organizationName,
          slug: await this.uniqueOrganizationSlug(organizationName),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      const user = await this.userRepository.createOne(
        {
          name,
          email,
          passwordHash,
          identityProvider: 'local',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      const member = await this.organizationMemberRepository.createOne(
        {
          organizationId: organization.id,
          userId: user.id,
          roleId: role.id,
          status: 'active',
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      const session = await this.createSession(user.id, member.id, tx);
      await tx.commit();
      return {
        user,
        member: { ...member, user, role, organization },
        role,
        organization,
        session,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async login(input: LoginInput): Promise<AuthSessionResult> {
    const email = this.validateEmail(input.email);
    const user = await this.userRepository.findOneBy({ email });
    if (!user?.passwordHash) throw new Error('Invalid email or password.');
    const passwordMatches = await bcrypt.compare(
      input.password || '',
      user.passwordHash,
    );
    if (!passwordMatches) throw new Error('Invalid email or password.');
    if (!user.isActive) throw new Error('This user is inactive.');

    const member =
      await this.organizationMemberRepository.findActiveMappingByUserId(
        user.id,
      );
    if (!member) throw new Error('This user is not an active member.');

    const now = new Date().toISOString();
    const tx = await this.userRepository.transaction();
    try {
      await this.userRepository.updateOne(
        user.id,
        { lastLoginAt: now, updatedAt: now },
        { tx },
      );
      const session = await this.createSession(user.id, member.id, tx);
      await tx.commit();
      return {
        user: { ...user, lastLoginAt: now },
        member,
        role: member.role,
        organization: member.organization,
        session,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async logout(token: string): Promise<boolean> {
    const session = await this.authSessionRepository.findOneBy({ token });
    if (!session) return true;
    await this.authSessionRepository.updateOne(session.id, {
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  public async getSession(token?: string | null) {
    if (!token) return null;
    const session = await this.authSessionRepository.findActiveByToken(token);
    if (!session) return null;
    const member = await this.organizationMemberRepository.findMappingById(
      session.organizationMemberId,
    );
    if (!member || member.status !== 'active' || !member.user.isActive) {
      return null;
    }
    return {
      user: member.user,
      member,
      role: member.role,
      organization: member.organization,
      session,
    };
  }

  public async listRoles(): Promise<RoleWithUsers[]> {
    const roles = await this.roleRepository.findAll({ order: 'name' });
    const mappings = await this.userRoleRepository.findMappings();
    return roles.map((role) => ({
      ...role,
      users: mappings
        .filter((mapping) => mapping.roleId === role.id)
        .map((mapping) => mapping.user),
    }));
  }

  public async createRole(
    input: CreateRoleInput,
    actor?: AuthActor | null,
  ): Promise<Role> {
    this.assertAdmin(actor);
    const name = this.validateRoleName(input.name);
    await this.assertUniqueRoleName(name);
    const now = new Date().toISOString();
    return this.roleRepository.createOne({
      name,
      description: this.normalizeNullable(input.description),
      createdAt: now,
      updatedAt: now,
    });
  }

  public async updateRole(
    input: UpdateRoleInput,
    actor?: AuthActor | null,
  ): Promise<Role> {
    this.assertAdmin(actor);
    const role = await this.getRoleOrThrow(input.id);
    const data: Partial<Role> = { updatedAt: new Date().toISOString() };

    if (input.name !== undefined && input.name !== null) {
      const name = this.validateRoleName(input.name);
      await this.assertUniqueRoleName(name, role.id);
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = this.normalizeNullable(input.description);
    }

    return this.roleRepository.updateOne(role.id, data);
  }

  public async listUsers(): Promise<RbacUserWithRoles[]> {
    const users = await this.userRepository.findAll({ order: 'email' });
    const mappings = await this.userRoleRepository.findMappings();
    return users.map((user) => ({
      ...user,
      roles: mappings
        .filter((mapping) => mapping.userId === user.id)
        .map((mapping) => mapping.role),
    }));
  }

  public async createUser(input: CreateUserInput): Promise<RbacUser> {
    const name = this.validateRequiredText(input.name, 'User name');
    const email = this.validateEmail(input.email);
    await this.assertUniqueUserEmail(email);
    const passwordHash = input.password
      ? await this.hashPassword(input.password)
      : null;
    const now = new Date().toISOString();

    const tx = await this.userRepository.transaction();
    try {
      const user = await this.userRepository.createOne(
        {
          name,
          email,
          passwordHash,
          externalId: this.normalizeNullable(input.externalId),
          identityProvider: this.normalizeNullable(input.identityProvider),
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );

      if (input.roleIds?.length) {
        await this.createUserRoleAssignments(user.id, input.roleIds, tx);
      }

      await tx.commit();
      return user;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async updateUser(input: UpdateUserInput): Promise<RbacUser> {
    const user = await this.getUserOrThrow(input.id);
    const data: Partial<RbacUser> = { updatedAt: new Date().toISOString() };

    if (input.name !== undefined && input.name !== null) {
      data.name = this.validateRequiredText(input.name, 'User name');
    }
    if (input.email !== undefined && input.email !== null) {
      const email = this.validateEmail(input.email);
      await this.assertUniqueUserEmail(email, user.id);
      data.email = email;
    }
    if (input.externalId !== undefined) {
      data.externalId = this.normalizeNullable(input.externalId);
    }
    if (input.identityProvider !== undefined) {
      data.identityProvider = this.normalizeNullable(input.identityProvider);
    }
    if (input.isActive !== undefined && input.isActive !== null) {
      data.isActive = input.isActive;
    }

    return this.userRepository.updateOne(user.id, data);
  }

  public async assignRoleToUser(input: UserRoleInput): Promise<UserRole> {
    await this.getUserOrThrow(input.userId);
    await this.getRoleOrThrow(input.roleId);
    const existing = await this.userRoleRepository.findOneBy(input);
    if (existing) return existing;

    const now = new Date().toISOString();
    return this.userRoleRepository.createOne({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async updateUserRoles(
    input: UpdateUserRolesInput,
  ): Promise<RbacUserWithRoles> {
    const user = await this.getUserOrThrow(input.userId);
    const roleIds = this.uniqueIds(input.roleIds);
    const tx = await this.userRoleRepository.transaction();

    try {
      await this.userRoleRepository.deleteAllBy({ userId: user.id }, { tx });
      if (roleIds.length) {
        await this.createUserRoleAssignments(user.id, roleIds, tx);
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }

    const mappings = await this.userRoleRepository.findMappingsByUserId(
      user.id,
    );
    return { ...user, roles: mappings.map((mapping) => mapping.role) };
  }

  public async removeRoleFromUser(input: UserRoleInput): Promise<boolean> {
    const existing = await this.userRoleRepository.findOneBy(input);
    if (!existing) return true;
    await this.userRoleRepository.deleteOne(existing.id);
    return true;
  }

  public async getUserRoleMappings(): Promise<UserRoleMapping[]> {
    return this.userRoleRepository.findMappings();
  }

  public async listOrganizations(): Promise<Organization[]> {
    return this.organizationRepository.findAll({ order: 'name' });
  }

  public async listMembers(actor?: AuthActor | null) {
    this.assertAdmin(actor);
    const organization = actor.organization;
    return this.organizationMemberRepository.findMappingsByOrganizationId(
      organization.id,
    );
  }

  public async listInvitations(actor?: AuthActor | null) {
    this.assertAdmin(actor);
    const organization = actor.organization;
    const invitations = await this.memberInvitationRepository.findMappings();
    return invitations.filter(
      (invitation) => invitation.organizationId === organization.id,
    );
  }

  public async inviteMember(
    input: InviteMemberInput,
    actor?: AuthActor | null,
  ): Promise<MemberInvitation> {
    this.assertAdmin(actor);
    const email = this.validateEmail(input.email);
    const role = await this.getRoleOrThrow(input.roleId);
    const organizationId = input.organizationId || actor.member.organizationId;
    const organization = await this.organizationRepository.findOneBy({
      id: organizationId,
    });
    if (!organization) throw new Error('Organization was not found.');

    const pending = await this.memberInvitationRepository.findAllBy({
      organizationId,
      email,
      status: 'pending',
    });
    if (pending.length) {
      throw new Error(`An invitation for "${email}" is already pending.`);
    }

    const existingUser = await this.userRepository.findOneBy({ email });
    if (existingUser) {
      const existingMember =
        await this.organizationMemberRepository.findActiveMappingByUserId(
          existingUser.id,
        );
      if (existingMember?.organizationId === organizationId) {
        throw new Error(`"${email}" is already a member.`);
      }
    }

    const now = new Date().toISOString();
    return this.memberInvitationRepository.createOne({
      organizationId,
      roleId: role.id,
      email,
      name: this.normalizeNullable(input.name),
      token: this.generateToken(),
      status: 'pending',
      invitedByMemberId: actor.member.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      createdAt: now,
      updatedAt: now,
    });
  }

  public async acceptInvitation(
    input: AcceptInvitationInput,
  ): Promise<AuthSessionResult> {
    const invitation = await this.memberInvitationRepository.findMappingByToken(
      input.token,
    );
    if (!invitation || invitation.status !== 'pending') {
      throw new Error('Invitation is invalid or has already been used.');
    }
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      throw new Error('Invitation has expired.');
    }

    const name = this.validateRequiredText(
      input.name || invitation.name || invitation.email,
      'Name',
    );
    const passwordHash = await this.hashPassword(input.password);
    const now = new Date().toISOString();
    const tx = await this.userRepository.transaction();

    try {
      let user = await this.userRepository.findOneBy(
        { email: invitation.email },
        { tx },
      );
      if (user) {
        user = await this.userRepository.updateOne(
          user.id,
          {
            name,
            passwordHash,
            identityProvider: user.identityProvider || 'local',
            isActive: true,
            updatedAt: now,
          },
          { tx },
        );
      } else {
        user = await this.userRepository.createOne(
          {
            name,
            email: invitation.email,
            passwordHash,
            identityProvider: 'local',
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
          { tx },
        );
      }

      const member = await this.organizationMemberRepository.createOne(
        {
          organizationId: invitation.organizationId,
          userId: user.id,
          roleId: invitation.roleId,
          status: 'active',
          invitedByMemberId: invitation.invitedByMemberId,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      await this.memberInvitationRepository.updateOne(
        invitation.id,
        { status: 'accepted', acceptedAt: now, updatedAt: now },
        { tx },
      );
      const session = await this.createSession(user.id, member.id, tx);
      await tx.commit();
      return {
        user,
        member: {
          ...member,
          user,
          role: invitation.role,
          organization: invitation.organization,
        },
        role: invitation.role,
        organization: invitation.organization,
        session,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async updateMember(
    input: UpdateMemberInput,
    actor?: AuthActor | null,
  ): Promise<OrganizationMemberMapping> {
    this.assertAdmin(actor);
    const member = await this.getMemberOrThrow(input.id);
    if (member.organizationId !== actor.member.organizationId) {
      throw new Error('Member is outside of your organization.');
    }
    const now = new Date().toISOString();
    if (input.name !== undefined && input.name !== null) {
      await this.userRepository.updateOne(member.userId, {
        name: this.validateRequiredText(input.name, 'Name'),
        updatedAt: now,
      });
    }
    const data: any = { updatedAt: now };
    if (input.roleId !== undefined && input.roleId !== null) {
      await this.getRoleOrThrow(input.roleId);
      data.roleId = input.roleId;
    }
    if (input.status !== undefined && input.status !== null) {
      data.status = this.validateMemberStatus(input.status);
    }
    await this.organizationMemberRepository.updateOne(member.id, data);
    return this.getMemberOrThrow(member.id);
  }

  public async updateMemberRole(
    input: UpdateMemberRoleInput,
    actor?: AuthActor | null,
  ) {
    return this.updateMember(
      { id: input.memberId, roleId: input.roleId },
      actor,
    );
  }

  private async createUserRoleAssignments(
    userId: number,
    roleIds: number[],
    tx: Knex.Transaction,
  ): Promise<void> {
    const uniqueRoleIds = this.uniqueIds(roleIds);
    for (const roleId of uniqueRoleIds) {
      await this.getRoleOrThrow(roleId);
    }
    const now = new Date().toISOString();
    await this.userRoleRepository.createMany(
      uniqueRoleIds.map((roleId) => ({
        userId,
        roleId,
        createdAt: now,
        updatedAt: now,
      })),
      { tx },
    );
  }

  private async getRoleOrThrow(id: number): Promise<Role> {
    const role = await this.roleRepository.findOneBy({ id });
    if (!role) throw new Error(`Role ${id} was not found.`);
    return role;
  }

  private async getRoleByNameOrThrow(name: string): Promise<Role> {
    const role = await this.roleRepository.findOneBy({ name });
    if (!role) throw new Error(`Role "${name}" was not found.`);
    return role;
  }

  private async getUserOrThrow(id: number): Promise<RbacUser> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new Error(`User ${id} was not found.`);
    return user;
  }

  private async getMemberOrThrow(
    id: number,
  ): Promise<OrganizationMemberMapping> {
    const member = await this.organizationMemberRepository.findMappingById(id);
    if (!member) throw new Error(`Member ${id} was not found.`);
    return member;
  }

  private assertAdmin(actor?: AuthActor | null): asserts actor is AuthActor {
    if (!actor || actor.role.name !== ADMIN_ROLE_NAME) {
      throw new Error('Admin role is required for this action.');
    }
  }

  private async createSession(
    userId: number,
    organizationMemberId: number,
    tx: Knex.Transaction,
  ): Promise<AuthSession> {
    const now = new Date().toISOString();
    return this.authSessionRepository.createOne(
      {
        userId,
        organizationMemberId,
        token: this.generateToken(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        createdAt: now,
        updatedAt: now,
      },
      { tx },
    );
  }

  private async assertUniqueRoleName(name: string, exceptId?: number) {
    const roles = await this.roleRepository.findAll();
    const duplicate = roles.find(
      (role) =>
        role.name.toLowerCase() === name.toLowerCase() && role.id !== exceptId,
    );
    if (duplicate) throw new Error(`Role "${name}" already exists.`);
  }

  private async assertUniqueUserEmail(email: string, exceptId?: number) {
    const users = await this.userRepository.findAll();
    const duplicate = users.find(
      (user) =>
        user.email.toLowerCase() === email.toLowerCase() &&
        user.id !== exceptId,
    );
    if (duplicate) throw new Error(`User "${email}" already exists.`);
  }

  private validateRoleName(name: string): string {
    return this.validateRequiredText(name, 'Role name');
  }

  private validateEmail(email: string): string {
    const normalized = this.validateRequiredText(email, 'Email').toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new Error('A valid email address is required.');
    }
    return normalized;
  }

  private validateMemberStatus(status: string): string {
    const normalized = this.validateRequiredText(status, 'Status');
    if (!['active', 'inactive', 'suspended'].includes(normalized)) {
      throw new Error('Member status must be active, inactive, or suspended.');
    }
    return normalized;
  }

  private async hashPassword(password: string): Promise<string> {
    const normalized = this.validateRequiredText(password, 'Password');
    if (normalized.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    return bcrypt.hash(normalized, 12);
  }

  private validateRequiredText(value: string, label: string): string {
    const normalized = `${value || ''}`.trim();
    if (!normalized) throw new Error(`${label} is required.`);
    return normalized;
  }

  private normalizeNullable(value?: string | null): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized || null;
  }

  private uniqueIds(ids: number[]): number[] {
    return Array.from(new Set((ids || []).filter(Boolean)));
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private async uniqueOrganizationSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    const safeBase = base || 'organization';
    let slug = safeBase;
    let index = 1;
    while (await this.organizationRepository.findOneBy({ slug })) {
      slug = `${safeBase}-${index}`;
      index += 1;
    }
    return slug;
  }
}
