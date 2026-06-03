import { IContext } from '@server/types';
import {
  CreateRoleInput,
  CreateUserInput,
  UpdateRoleInput,
  UpdateUserInput,
  UpdateUserRolesInput,
  UserRoleInput,
} from '@server/models';
import {
  RbacUser,
  Role,
  UserRole,
  UserRoleMapping,
} from '@server/repositories';
import { RbacUserWithRoles, RoleWithUsers } from '@server/services';
import { getLogger } from '@server/utils';

const logger = getLogger('RbacResolver');
logger.level = 'debug';

export class RbacResolver {
  constructor() {
    this.listRoles = this.listRoles.bind(this);
    this.listUsers = this.listUsers.bind(this);
    this.listUserRoleMappings = this.listUserRoleMappings.bind(this);
    this.createRole = this.createRole.bind(this);
    this.updateRole = this.updateRole.bind(this);
    this.createUser = this.createUser.bind(this);
    this.updateUser = this.updateUser.bind(this);
    this.assignRoleToUser = this.assignRoleToUser.bind(this);
    this.updateUserRoles = this.updateUserRoles.bind(this);
    this.removeRoleFromUser = this.removeRoleFromUser.bind(this);
  }

  public getRoleNestedResolver() {
    return {
      users: async (role: RoleWithUsers, _args: any, ctx: IContext) => {
        if (role.users) return role.users;
        const mappings = await ctx.rbacService.getUserRoleMappings();
        return mappings
          .filter((mapping) => mapping.roleId === role.id)
          .map((mapping) => mapping.user);
      },
    };
  }

  public getUserNestedResolver() {
    return {
      roles: async (user: RbacUserWithRoles, _args: any, ctx: IContext) => {
        if (user.roles) return user.roles;
        const mappings = await ctx.rbacService.getUserRoleMappings();
        return mappings
          .filter((mapping) => mapping.userId === user.id)
          .map((mapping) => mapping.role);
      },
    };
  }

  public async listRoles(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<RoleWithUsers[]> {
    try {
      return await ctx.rbacService.listRoles();
    } catch (error) {
      logger.error(`Error listing roles: ${error}`);
      throw error;
    }
  }

  public async listUsers(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<RbacUserWithRoles[]> {
    try {
      return await ctx.rbacService.listUsers();
    } catch (error) {
      logger.error(`Error listing users: ${error}`);
      throw error;
    }
  }

  public async listUserRoleMappings(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<UserRoleMapping[]> {
    return ctx.rbacService.getUserRoleMappings();
  }

  public async createRole(
    _root: any,
    args: { data: CreateRoleInput },
    ctx: IContext,
  ): Promise<Role> {
    return ctx.rbacService.createRole(args.data);
  }

  public async updateRole(
    _root: any,
    args: { where: { id: number }; data: Omit<UpdateRoleInput, 'id'> },
    ctx: IContext,
  ): Promise<Role> {
    return ctx.rbacService.updateRole({ id: args.where.id, ...args.data });
  }

  public async createUser(
    _root: any,
    args: { data: CreateUserInput },
    ctx: IContext,
  ): Promise<RbacUser> {
    return ctx.rbacService.createUser(args.data);
  }

  public async updateUser(
    _root: any,
    args: { where: { id: number }; data: Omit<UpdateUserInput, 'id'> },
    ctx: IContext,
  ): Promise<RbacUser> {
    return ctx.rbacService.updateUser({ id: args.where.id, ...args.data });
  }

  public async assignRoleToUser(
    _root: any,
    args: { data: UserRoleInput },
    ctx: IContext,
  ): Promise<UserRole> {
    return ctx.rbacService.assignRoleToUser(args.data);
  }

  public async updateUserRoles(
    _root: any,
    args: { data: UpdateUserRolesInput },
    ctx: IContext,
  ): Promise<RbacUserWithRoles> {
    return ctx.rbacService.updateUserRoles(args.data);
  }

  public async removeRoleFromUser(
    _root: any,
    args: { data: UserRoleInput },
    ctx: IContext,
  ): Promise<boolean> {
    return ctx.rbacService.removeRoleFromUser(args.data);
  }
}
