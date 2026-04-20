export const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  viewer: '查看者',
};

export const STATUS_LABELS: Record<string, string> = {
  active: '启用',
  invited: '待接受',
  pending: '待审批',
  rejected: '已拒绝',
  inactive: '停用',
};

export const WORKSPACE_KIND_LABELS: Record<string, string> = {
  regular: '业务空间',
  default: '系统样例空间',
};

export const IDENTITY_PROVIDER_LABELS: Record<string, string> = {
  oidc: 'OIDC',
  saml: 'SAML',
};

export const applicationStatusColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'green';
    case 'pending':
      return 'gold';
    case 'invited':
      return 'blue';
    case 'rejected':
      return 'red';
    case 'inactive':
      return 'default';
    default:
      return 'default';
  }
};

export const workspaceKindColor = (kind?: string | null) => {
  switch (kind) {
    case 'default':
      return 'geekblue';
    case 'regular':
      return 'green';
    default:
      return 'default';
  }
};

export const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getCertificateExpiryStatus = (
  configJson?: Record<string, any> | null,
) => {
  const certificateSummaries = configJson?.signingCertificateSummaries;
  const summaries = Array.isArray(certificateSummaries)
    ? certificateSummaries
    : [];
  if (summaries.some((summary) => summary?.status === 'expired')) {
    return {
      text: '证书已过期，请尽快刷新 metadata 或替换证书',
      type: 'danger' as const,
      level: 'expired' as const,
    };
  }
  if (summaries.some((summary) => summary?.status === 'expiring_soon')) {
    return {
      text: '证书将在 30 天内到期，请尽快刷新 metadata 或替换证书',
      type: 'warning' as const,
      level: 'expiring_soon' as const,
    };
  }
  const expiryAt = configJson?.earliestCertificateExpiryAt;
  if (!expiryAt) {
    return {
      text: '最近证书到期：—',
      type: 'secondary' as const,
      level: 'unknown' as const,
    };
  }

  const expiryDate = new Date(expiryAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return {
      text: '最近证书到期：—',
      type: 'secondary' as const,
      level: 'unknown' as const,
    };
  }

  const diff = expiryDate.getTime() - Date.now();
  if (diff <= 0) {
    return {
      text: `证书已于 ${formatDateTime(expiryAt)} 过期`,
      type: 'danger' as const,
      level: 'expired' as const,
    };
  }
  if (diff <= 30 * 24 * 60 * 60 * 1000) {
    return {
      text: `最近证书将于 ${formatDateTime(expiryAt)} 到期`,
      type: 'warning' as const,
      level: 'expiring_soon' as const,
    };
  }

  return {
    text: `最近证书到期：${formatDateTime(expiryAt)}`,
    type: 'secondary' as const,
    level: 'healthy' as const,
  };
};
