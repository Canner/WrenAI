import crypto from 'crypto';
import {
  AuthIdentity,
  IAuthIdentityRepository,
  ISSOSessionRepository,
  IUserRepository,
} from '@server/repositories';
import { IAuthService } from './authService';
import { IWorkspaceService } from './workspaceService';
import {
  buildProviderSubject,
  normalizeGroupMappings,
  rolePriority,
  SSOClaims,
} from './identityProviderServiceShared';

export const completeProvisionedIdentity = async ({
  ssoSession,
  provider,
  claims,
  userRepository,
  authIdentityRepository,
  workspaceService,
  authService,
  ssoSessionRepository,
}: {
  ssoSession: any;
  provider: {
    id: string;
    providerType: string;
    configJson?: Record<string, any> | null;
  };
  claims: SSOClaims;
  userRepository: IUserRepository;
  authIdentityRepository: IAuthIdentityRepository;
  workspaceService: IWorkspaceService;
  authService: IAuthService;
  ssoSessionRepository: ISSOSessionRepository;
}) => {
  const providerSubject = buildProviderSubject(
    provider.id,
    claims.externalSubject,
  );

  const tx = await userRepository.transaction();
  let authIdentity: AuthIdentity;
  let userId: string;

  try {
    authIdentity =
      (await authIdentityRepository.findOneBy(
        {
          identityProviderConfigId: provider.id,
          externalSubject: claims.externalSubject,
        },
        { tx },
      )) ||
      (await authIdentityRepository.findOneBy(
        {
          providerType: provider.providerType,
          providerSubject,
        },
        { tx },
      ))!;

    let user =
      authIdentity &&
      (await userRepository.findOneBy({ id: authIdentity.userId }, { tx }));

    if (!user && claims.email) {
      user = await userRepository.findOneBy(
        { email: claims.email.toLowerCase() },
        { tx },
      );
    }

    const autoProvision = provider.configJson?.autoProvision !== false;
    if (!user && !autoProvision) {
      throw new Error(
        'User provisioning is disabled for this identity provider',
      );
    }

    if (!user) {
      if (!claims.email) {
        throw new Error('SSO email claim is required for auto provisioning');
      }

      user = await userRepository.createOne(
        {
          id: crypto.randomUUID(),
          email: claims.email.toLowerCase(),
          displayName: claims.displayName,
          status: 'active',
          defaultWorkspaceId: ssoSession.workspaceId,
        },
        { tx },
      );
    } else if (
      user.status !== 'active' ||
      user.displayName !== claims.displayName
    ) {
      user = await userRepository.updateOne(
        user.id,
        {
          status: 'active',
          displayName: claims.displayName || user.displayName,
        },
        { tx },
      );
    }

    userId = user.id;

    if (authIdentity) {
      authIdentity = await authIdentityRepository.updateOne(
        authIdentity.id,
        {
          userId,
          providerSubject,
          providerType: provider.providerType,
          identityProviderConfigId: provider.id,
          issuer: claims.issuer || null,
          externalSubject: claims.externalSubject,
          metadata: {
            lastLoginAt: new Date().toISOString(),
          },
        },
        { tx },
      );
    } else {
      authIdentity = await authIdentityRepository.createOne(
        {
          id: crypto.randomUUID(),
          userId,
          providerType: provider.providerType,
          providerSubject,
          identityProviderConfigId: provider.id,
          issuer: claims.issuer || null,
          externalSubject: claims.externalSubject,
          emailVerifiedAt: claims.email ? new Date() : null,
          metadata: {
            lastLoginAt: new Date().toISOString(),
          },
        },
        { tx },
      );
    }

    if (!user.defaultWorkspaceId) {
      await userRepository.updateOne(
        user.id,
        { defaultWorkspaceId: ssoSession.workspaceId },
        { tx },
      );
    }

    await ssoSessionRepository.updateOne(
      ssoSession.id,
      { consumedAt: new Date() },
      { tx },
    );

    await userRepository.commit(tx);
  } catch (error) {
    await userRepository.rollback(tx);
    throw error;
  }

  const desiredRoleKey = resolveMappedRoleKey(
    claims.groups,
    normalizeGroupMappings(provider.configJson?.groupRoleMappings),
  );
  const existingMembership = await workspaceService.getMembership(
    ssoSession.workspaceId,
    userId,
  );
  await workspaceService.addMember({
    workspaceId: ssoSession.workspaceId,
    userId,
    roleKey: desiredRoleKey || existingMembership?.roleKey || 'member',
    status: 'active',
  });

  return authService.issueSessionForIdentity({
    userId,
    authIdentityId: authIdentity.id,
    workspaceId: ssoSession.workspaceId,
  });
};

export const resolveMappedRoleKey = (
  groups: string[],
  mappings: Array<{ group: string; roleKey: string }>,
) => {
  const matched = mappings
    .filter((mapping) => groups.includes(mapping.group))
    .sort(
      (left, right) =>
        (rolePriority[right.roleKey] || 0) - (rolePriority[left.roleKey] || 0),
    );
  return matched[0]?.roleKey || null;
};
