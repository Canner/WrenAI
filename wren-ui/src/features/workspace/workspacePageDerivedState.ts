import type { WorkspaceOverviewPayload } from './workspacePageTypes';
import {
  getCertificateExpiryStatus,
  IDENTITY_PROVIDER_LABELS,
} from './workspacePageUtils';

const filterWorkspaceItems = <
  T extends {
    name?: string | null;
    slug?: string | null;
  },
>(
  items: T[],
  normalizedSearchKeyword: string,
) => {
  if (!normalizedSearchKeyword) {
    return items;
  }

  return items.filter((item) => {
    const name = String(item.name || '').toLowerCase();
    const slug = String(item.slug || '').toLowerCase();
    return (
      name.includes(normalizedSearchKeyword) ||
      slug.includes(normalizedSearchKeyword)
    );
  });
};

export default function buildWorkspacePageDerivedState({
  data,
  searchKeyword,
}: {
  data: WorkspaceOverviewPayload | null;
  searchKeyword: string;
}) {
  const workspaceCards = data?.workspaces || [];
  const discoverableWorkspaces = data?.discoverableWorkspaces || [];
  const applicationRecords = data?.applications || [];
  const reviewQueue = data?.reviewQueue || [];
  const permissionActions = data?.permissions?.actions || {};
  const canManageMembers =
    Boolean(permissionActions['workspace.member.status.update']) ||
    Boolean(data?.permissions?.canManageMembers);
  const canInviteMembers =
    Boolean(permissionActions['workspace.member.invite']) ||
    Boolean(data?.permissions?.canInviteMembers);
  const canCreateWorkspace =
    Boolean(permissionActions['workspace.create']) ||
    Boolean(data?.permissions?.canCreateWorkspace);
  const canReadServiceAccounts = Boolean(
    permissionActions['service_account.read'],
  );
  const canReadApiTokens = Boolean(permissionActions['api_token.read']);
  const canReadIdentityProviders = Boolean(
    permissionActions['identity_provider.read'],
  );
  const canReadAccessReviews = Boolean(permissionActions['access_review.read']);
  const canReadGroups = Boolean(permissionActions['group.read']);
  const canManageBreakGlass = Boolean(permissionActions['break_glass.manage']);
  const canStartImpersonation = Boolean(
    permissionActions['impersonation.start'],
  );
  const defaultWorkspaceId =
    data?.defaultWorkspaceId || data?.user?.defaultWorkspaceId || null;
  const isPlatformAdmin = canCreateWorkspace || Boolean(data?.isPlatformAdmin);
  const identityProviders = data?.identityProviders || [];
  const enabledIdentityProviderCount = identityProviders.filter(
    (provider) => provider.enabled,
  ).length;

  let expiredProviderCount = 0;
  let expiringSoonProviderCount = 0;
  identityProviders.forEach((provider) => {
    if (!provider.enabled || provider.providerType !== 'saml') {
      return;
    }
    const status = getCertificateExpiryStatus(provider.configJson);
    if (status.level === 'expired') {
      expiredProviderCount += 1;
    } else if (status.level === 'expiring_soon') {
      expiringSoonProviderCount += 1;
    }
  });

  const samlCertificateAlertSummary =
    !expiredProviderCount && !expiringSoonProviderCount
      ? null
      : expiredProviderCount > 0
        ? {
            type: 'error' as const,
            message: 'SAML 证书健康告警',
            description:
              expiringSoonProviderCount > 0
                ? `有 ${expiredProviderCount} 个已启用 SAML 提供方证书已过期，另有 ${expiringSoonProviderCount} 个将在 30 天内到期，请前往“设置 > 身份与目录”处理。`
                : `有 ${expiredProviderCount} 个已启用 SAML 提供方证书已过期，请前往“设置 > 身份与目录”处理。`,
          }
        : {
            type: 'warning' as const,
            message: 'SAML 证书健康告警',
            description: `有 ${expiringSoonProviderCount} 个已启用 SAML 提供方证书将在 30 天内到期，请前往“设置 > 身份与目录”处理。`,
          };

  const scimEnabledProviderCount = identityProviders.filter((provider) =>
    Boolean(
      provider.configJson?.hasScimBearerToken ||
        provider.configJson?.scimBearerToken,
    ),
  ).length;
  const accessReviews = data?.accessReviews || [];
  const directoryGroups = data?.directoryGroups || [];
  const breakGlassGrants = data?.breakGlassGrants || [];
  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();
  const filteredWorkspaceCards = filterWorkspaceItems(
    workspaceCards,
    normalizedSearchKeyword,
  );
  const filteredDiscoverableWorkspaces = filterWorkspaceItems(
    discoverableWorkspaces,
    normalizedSearchKeyword,
  );
  const filteredApplicationRecords = !normalizedSearchKeyword
    ? applicationRecords
    : applicationRecords.filter((item) =>
        String(item.workspaceName || '')
          .toLowerCase()
          .includes(normalizedSearchKeyword),
      );

  const governanceCenterVisible =
    canInviteMembers ||
    canManageMembers ||
    canReadServiceAccounts ||
    canReadApiTokens ||
    canReadIdentityProviders ||
    canReadAccessReviews ||
    canReadGroups ||
    canManageBreakGlass ||
    canStartImpersonation;

  const activeBreakGlassCount = breakGlassGrants.filter(
    (grant) => !grant.revokedAt && grant.status === 'active',
  ).length;
  const recentEnabledIdentityProviders = identityProviders
    .filter((provider) => provider.enabled)
    .slice(0, 2)
    .map(
      (provider) =>
        `${IDENTITY_PROVIDER_LABELS[provider.providerType] || provider.providerType} · ${provider.name}`,
    );

  return {
    reviewQueue,
    canManageMembers,
    defaultWorkspaceId,
    isPlatformAdmin,
    filteredWorkspaceCards,
    filteredDiscoverableWorkspaces,
    filteredApplicationRecords,
    governanceCenterVisible,
    samlCertificateAlertSummary,
    enabledIdentityProviderCount,
    directoryGroups,
    scimEnabledProviderCount,
    recentEnabledIdentityProviders,
    accessReviews,
    activeBreakGlassCount,
  };
}
