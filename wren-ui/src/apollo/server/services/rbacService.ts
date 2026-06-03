import { Knex } from 'knex';
import {
  CreateRoleInput,
  CreateUserInput,
  UpdateRoleInput,
  UpdateUserInput,
  UpdateUserRolesInput,
  UserRoleInput,
} from '@server/models';
import {
  IRoleRepository,
  IUserRepository,
  IUserRoleRepository,
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
  listRoles(): Promise<RoleWithUsers[]>;
  createRole(input: CreateRoleInput): Promise<Role>;
  updateRole(input: UpdateRoleInput): Promise<Role>;
  listUsers(): Promise<RbacUserWithRoles[]>;
  createUser(input: CreateUserInput): Promise<RbacUser>;
  updateUser(input: UpdateUserInput): Promise<RbacUser>;
  assignRoleToUser(input: UserRoleInput): Promise<UserRole>;
  updateUserRoles(input: UpdateUserRolesInput): Promise<RbacUserWithRoles>;
  removeRoleFromUser(input: UserRoleInput): Promise<boolean>;
  getUserRoleMappings(): Promise<UserRoleMapping[]>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RbacService implements IRbacService {
  private readonly roleRepository: IRoleRepository;
  private readonly userRepository: IUserRepository;
  private readonly userRoleRepository: IUserRoleRepository;

  constructor({
    roleRepository,
    userRepository,
    userRoleRepository,
  }: {
    roleRepository: IRoleRepository;
    userRepository: IUserRepository;
    userRoleRepository: IUserRoleRepository;
  }) {
    this.roleRepository = roleRepository;
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
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

  public async createRole(input: CreateRoleInput): Promise<Role> {
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

  public async updateRole(input: UpdateRoleInput): Promise<Role> {
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
    const now = new Date().toISOString();

    const tx = await this.userRepository.transaction();
    try {
      const user = await this.userRepository.createOne(
        {
          name,
          email,
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

  private async getUserOrThrow(id: number): Promise<RbacUser> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new Error(`User ${id} was not found.`);
    return user;
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
}
