export type CertificateHealthLevel =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'unknown';

type CertificateHealthStatus = {
  level: CertificateHealthLevel;
  label: string;
  color: 'green' | 'orange' | 'red' | 'default';
};

export const getCertificateExpiryStatus = (
  configJson?: Record<string, any> | null,
  now = Date.now(),
): CertificateHealthStatus => {
  const certificateSummaries = configJson?.signingCertificateSummaries;
  const summaries = Array.isArray(certificateSummaries)
    ? certificateSummaries
    : [];

  if (summaries.some((summary) => summary?.status === 'expired')) {
    return {
      level: 'expired',
      label: '证书已过期',
      color: 'red',
    };
  }

  if (summaries.some((summary) => summary?.status === 'expiring_soon')) {
    return {
      level: 'expiring_soon',
      label: '30 天内到期',
      color: 'orange',
    };
  }

  const expiryAt = configJson?.earliestCertificateExpiryAt;
  if (!expiryAt) {
    return {
      level: 'unknown',
      label: '未发现证书信息',
      color: 'default',
    };
  }

  const expiryDate = new Date(expiryAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return {
      level: 'unknown',
      label: '证书状态未知',
      color: 'default',
    };
  }

  const diff = expiryDate.getTime() - now;
  if (diff <= 0) {
    return {
      level: 'expired',
      label: '证书已过期',
      color: 'red',
    };
  }

  if (diff <= 30 * 24 * 60 * 60 * 1000) {
    return {
      level: 'expiring_soon',
      label: '30 天内到期',
      color: 'orange',
    };
  }

  return {
    level: 'valid',
    label: '证书健康',
    color: 'green',
  };
};

export const getIdentityProviderMetadataState = (
  configJson?: Record<string, any> | null,
) => {
  if (configJson?.metadataUrl) {
    return {
      source: 'url' as const,
      label: 'Metadata URL',
      fetchedAt: configJson?.metadataFetchedAt || null,
    };
  }

  if (configJson?.metadataXml) {
    return {
      source: 'xml' as const,
      label: '内嵌 XML',
      fetchedAt: configJson?.metadataFetchedAt || null,
    };
  }

  return {
    source: 'none' as const,
    label: '未配置',
    fetchedAt: null,
  };
};

export const hasIdentityProviderScim = (
  configJson?: Record<string, any> | null,
) => Boolean(configJson?.hasScimBearerToken || configJson?.scimBearerToken);
