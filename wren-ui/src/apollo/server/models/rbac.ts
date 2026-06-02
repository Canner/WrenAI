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
