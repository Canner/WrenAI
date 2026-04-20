import {
  IDirectoryGroupMemberRepository,
  IDirectoryGroupRepository,
  IPermissionRepository,
  IPrincipalRoleBindingRepository,
  IRolePermissionRepository,
  IRoleRepository,
  IServiceAccountRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
} from '@server/repositories';

export type RoleCatalogDeps = {
  roleRepository: IRoleRepository;
  permissionRepository: IPermissionRepository;
  rolePermissionRepository: IRolePermissionRepository;
  principalRoleBindingRepository: IPrincipalRoleBindingRepository;
};

export type BindingCatalogDeps = RoleCatalogDeps & {
  userRepository: IUserRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  directoryGroupRepository: IDirectoryGroupRepository;
  serviceAccountRepository: IServiceAccountRepository;
  directoryGroupMemberRepository: IDirectoryGroupMemberRepository;
};

export type WorkspaceRoleCatalogItem = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  scopeId?: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionNames: string[];
  bindingCount: number;
};

export type WorkspaceRoleBindingItem = {
  id: string;
  principalType: string;
  principalId: string;
  principalLabel: string;
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  isSystem: boolean;
  createdBy?: string | null;
  createdAt?: Date | string | null;
};
