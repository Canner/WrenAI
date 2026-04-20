import {
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IUserRepository,
  Workspace,
  WorkspaceMember,
} from '../repositories';
import { AuthorizationActor } from '@server/authz';
import type { ValidateSessionResult } from './authService';

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  settings?: Record<string, any>;
  createdBy?: string;
  initialOwnerUserId?: string;
  actor?: AuthorizationActor | null;
}

export interface AddWorkspaceMemberInput {
  workspaceId: string;
  userId: string;
  roleKey?: string;
  status?: string;
  actor?: AuthorizationActor | null;
}

export interface InviteWorkspaceMemberInput {
  workspaceId: string;
  email: string;
  roleKey?: string;
  status?: string;
  actor?: AuthorizationActor | null;
}

export interface UpdateWorkspaceMemberInput {
  workspaceId: string;
  memberId: string;
  roleKey?: string;
  status?: string;
  actor?: AuthorizationActor | null;
}

export interface UpdateWorkspaceSettingsInput {
  workspaceId: string;
  settings: Record<string, any>;
}

export interface UpdateDefaultWorkspaceInput {
  validatedSession: ValidateSessionResult;
  defaultWorkspaceId: string;
}

export interface IWorkspaceService {
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceById(workspaceId: string): Promise<Workspace | null>;
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  addMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMember>;
  inviteMemberByEmail(
    input: InviteWorkspaceMemberInput,
  ): Promise<WorkspaceMember>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null>;
  updateMember(input: UpdateWorkspaceMemberInput): Promise<WorkspaceMember>;
  removeMember(input: { workspaceId: string; memberId: string }): Promise<void>;
  updateWorkspaceSettings(
    input: UpdateWorkspaceSettingsInput,
  ): Promise<Workspace>;
  applyToWorkspace(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember>;
  acceptInvitation(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember>;
  updateDefaultWorkspace(input: UpdateDefaultWorkspaceInput): Promise<void>;
}

export interface WorkspaceServiceDependencies {
  workspaceRepository: IWorkspaceRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  userRepository: IUserRepository;
  roleRepository?: IRoleRepository;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
}
