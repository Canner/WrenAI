export interface CreateRoleInput {
  name: string;
  description?: string | null;
}

export interface UpdateRoleInput {
  id: number;
  name?: string | null;
  description?: string | null;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password?: string | null;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive?: boolean;
  roleIds?: number[];
}

export interface UpdateUserInput {
  id: number;
  name?: string | null;
  email?: string | null;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive?: boolean | null;
}

export interface UserRoleInput {
  userId: number;
  roleId: number;
}

export interface UpdateUserRolesInput {
  userId: number;
  roleIds: number[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface BootstrapAdminInput {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

export interface InviteMemberInput {
  organizationId?: number | null;
  email: string;
  name?: string | null;
  roleId: number;
}

export interface AcceptInvitationInput {
  token: string;
  name?: string | null;
  password: string;
}

export interface UpdateMemberInput {
  id: number;
  name?: string | null;
  roleId?: number | null;
  status?: string | null;
}

export interface UpdateMemberRoleInput {
  memberId: number;
  roleId: number;
}
