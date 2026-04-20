import { IdentityProviderConfig } from '@server/repositories';

export type ProviderConfigJson = {
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
