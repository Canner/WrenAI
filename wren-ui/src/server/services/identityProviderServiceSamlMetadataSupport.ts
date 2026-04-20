import crypto from 'crypto';
import {
  IdentityProviderConfig,
  IIdentityProviderConfigRepository,
} from '@server/repositories';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { XMLParser } = require('fast-xml-parser');

import {
  ensureArray,
  normalizeCertificateArray,
  readSamlConfig,
  SAML_CERTIFICATE_EXPIRY_WARNING_DAYS,
  SAML_HTTP_POST_BINDING,
  SAML_HTTP_REDIRECT_BINDING,
  SAML_METADATA_AUTO_REFRESH_INTERVAL_MS,
  SAMLProviderConfig,
  SamlCertificateSummary,
  stripDerivedProviderConfigFields,
  xmlEscape,
} from './identityProviderServiceShared';

export const extractSamlMetadataConfig = (
  metadataXml: string,
): Partial<SAMLProviderConfig> => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
  });
  const parsed = parser.parse(metadataXml);
  const entityCandidates = [
    parsed?.EntityDescriptor,
    ...ensureArray(parsed?.EntitiesDescriptor?.EntityDescriptor),
  ].filter(Boolean);
  const entityDescriptor = entityCandidates.find((candidate) =>
    Boolean(candidate?.IDPSSODescriptor),
  );
  if (!entityDescriptor) {
    throw new Error('SAML metadata must contain an IDPSSODescriptor');
  }

  const idpDescriptor = ensureArray(entityDescriptor.IDPSSODescriptor)[0];
  const singleSignOnServices = ensureArray(idpDescriptor?.SingleSignOnService);
  const preferredService =
    singleSignOnServices.find(
      (service) => service?.Binding === SAML_HTTP_REDIRECT_BINDING,
    ) ||
    singleSignOnServices.find(
      (service) => service?.Binding === SAML_HTTP_POST_BINDING,
    ) ||
    singleSignOnServices[0];
  if (!preferredService?.Location) {
    throw new Error('SAML metadata is missing SingleSignOnService Location');
  }

  const signingCertificates = normalizeCertificateArray(
    ensureArray(idpDescriptor?.KeyDescriptor).flatMap((keyDescriptor) => {
      const useValue = String(keyDescriptor?.use || '')
        .trim()
        .toLowerCase();
      if (useValue && useValue !== 'signing') {
        return [];
      }
      return ensureArray(keyDescriptor?.KeyInfo).flatMap((keyInfo) =>
        ensureArray(keyInfo?.X509Data).flatMap((x509Data) =>
          ensureArray(x509Data?.X509Certificate),
        ),
      );
    }),
  );

  return {
    issuer: String(entityDescriptor?.entityID || '').trim() || undefined,
    entryPoint: String(preferredService.Location || '').trim() || undefined,
    signingCertificates,
    signingCertificate: signingCertificates[0],
  };
};

export const isSamlMetadataRefreshStale = (config: SAMLProviderConfig) => {
  const metadataUrl = String(config.metadataUrl || '').trim();
  if (!metadataUrl) {
    return false;
  }

  const metadataFetchedAt = String(config.metadataFetchedAt || '').trim();
  if (!metadataFetchedAt) {
    return true;
  }

  const fetchedAtDate = new Date(metadataFetchedAt);
  if (Number.isNaN(fetchedAtDate.getTime())) {
    return true;
  }

  return (
    Date.now() - fetchedAtDate.getTime() >=
    SAML_METADATA_AUTO_REFRESH_INTERVAL_MS
  );
};

export const fetchSamlMetadataXml = async (metadataUrl: string) => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(metadataUrl);
  } catch {
    throw new Error('SAML metadata URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('SAML metadata URL must use http or https');
  }

  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept:
          'application/samlmetadata+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });
  } catch (error) {
    throw new Error(
      `Failed to fetch SAML metadata URL: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch SAML metadata URL: HTTP ${response.status}`,
    );
  }

  const metadataXml = (await response.text()).trim();
  if (!metadataXml) {
    throw new Error('SAML metadata URL returned empty metadata XML');
  }

  return {
    metadataXml,
    metadataFetchedAt: new Date().toISOString(),
  };
};

export const normalizeSamlConfigJson = async (
  configJson: Record<string, any>,
) => {
  const normalized = stripDerivedProviderConfigFields(configJson);
  const metadataUrl =
    typeof normalized.metadataUrl === 'string'
      ? normalized.metadataUrl.trim()
      : '';
  const shouldPreferFetchedMetadata = Boolean(metadataUrl);
  if (metadataUrl) {
    const fetchedMetadata = await fetchSamlMetadataXml(metadataUrl);
    normalized.metadataUrl = metadataUrl;
    normalized.metadataXml = fetchedMetadata.metadataXml;
    normalized.metadataFetchedAt = fetchedMetadata.metadataFetchedAt;
  } else {
    delete normalized.metadataUrl;
    delete normalized.metadataFetchedAt;
  }

  const metadataXml =
    typeof normalized.metadataXml === 'string'
      ? normalized.metadataXml.trim()
      : '';
  if (metadataXml) {
    const metadataConfig = extractSamlMetadataConfig(metadataXml);
    normalized.metadataXml = metadataXml;
    if (
      (shouldPreferFetchedMetadata ||
        !String(normalized.issuer || '').trim()) &&
      metadataConfig.issuer
    ) {
      normalized.issuer = metadataConfig.issuer;
    }
    if (
      (shouldPreferFetchedMetadata ||
        !String(normalized.entryPoint || '').trim()) &&
      metadataConfig.entryPoint
    ) {
      normalized.entryPoint = metadataConfig.entryPoint;
    }
    const explicitCertificates = normalizeCertificateArray([
      ...ensureArray(normalized.signingCertificates),
      normalized.signingCertificate,
      normalized.x509Certificate,
      normalized.certificate,
    ]);
    const effectiveCertificates =
      explicitCertificates.length > 0
        ? explicitCertificates
        : normalizeCertificateArray(metadataConfig.signingCertificates || []);
    if (effectiveCertificates.length > 0) {
      normalized.signingCertificates = effectiveCertificates;
      normalized.signingCertificate = effectiveCertificates[0];
    }
  } else {
    delete normalized.metadataXml;
    const explicitCertificates = normalizeCertificateArray([
      ...ensureArray(normalized.signingCertificates),
      normalized.signingCertificate,
      normalized.x509Certificate,
      normalized.certificate,
    ]);
    if (explicitCertificates.length > 0) {
      normalized.signingCertificates = explicitCertificates;
      normalized.signingCertificate = explicitCertificates[0];
    } else {
      delete normalized.signingCertificates;
      delete normalized.signingCertificate;
    }
  }

  if (!Array.isArray(normalized.groupRoleMappings)) {
    delete normalized.groupRoleMappings;
  }

  return normalized;
};

export const maybeRefreshSamlMetadataProvider = async ({
  provider,
  identityProviderConfigRepository,
  options,
}: {
  provider: IdentityProviderConfig;
  identityProviderConfigRepository: IIdentityProviderConfigRepository;
  options?: { force?: boolean; softFail?: boolean };
}) => {
  if (provider.providerType !== 'saml') {
    return provider;
  }

  const config = readSamlConfig(provider);
  if (!String(config.metadataUrl || '').trim()) {
    return provider;
  }
  if (!options?.force && !isSamlMetadataRefreshStale(config)) {
    return provider;
  }

  try {
    const nextConfigJson = await normalizeSamlConfigJson(
      stripDerivedProviderConfigFields(provider.configJson || {}),
    );
    if (!nextConfigJson) {
      return provider;
    }
    return await identityProviderConfigRepository.updateOne(provider.id, {
      configJson: nextConfigJson,
    });
  } catch (error) {
    const hasCachedMetadata =
      Boolean(String(config.metadataXml || '').trim()) ||
      Boolean(String(config.entryPoint || '').trim()) ||
      normalizeCertificateArray([
        ...ensureArray(config.signingCertificates),
        config.signingCertificate,
        config.x509Certificate,
        config.certificate,
      ]).length > 0;
    if (options?.softFail !== false && hasCachedMetadata) {
      return provider;
    }
    throw error;
  }
};

const normalizeCertificateDate = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

export const buildSamlCertificateSummaries = (
  config: SAMLProviderConfig,
): SamlCertificateSummary[] => {
  const now = Date.now();
  const warningThreshold =
    now + SAML_CERTIFICATE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  const rawCertificates = normalizeCertificateArray([
    ...ensureArray(config.signingCertificates),
    config.signingCertificate,
    config.x509Certificate,
    config.certificate,
  ]);
  return rawCertificates.map((certificate) => {
    const normalizedCertificate = normalizeSigningCertificatePem(certificate);
    const source = normalizedCertificate?.includes('BEGIN PUBLIC KEY')
      ? 'public_key'
      : 'certificate';
    if (!normalizedCertificate) {
      return {
        subject: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        fingerprint256: null,
        source,
        status: 'unparsed',
      };
    }

    try {
      const x509 = new crypto.X509Certificate(normalizedCertificate);
      const validTo = normalizeCertificateDate(x509.validTo);
      const validToTime = validTo ? new Date(validTo).getTime() : null;
      let status: SamlCertificateSummary['status'] = 'valid';
      if (validToTime != null && validToTime <= now) {
        status = 'expired';
      } else if (validToTime != null && validToTime <= warningThreshold) {
        status = 'expiring_soon';
      }
      return {
        subject: x509.subject || null,
        issuer: x509.issuer || null,
        validFrom: normalizeCertificateDate(x509.validFrom),
        validTo,
        fingerprint256: x509.fingerprint256 || null,
        source,
        status,
      };
    } catch {
      return {
        subject: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        fingerprint256: null,
        source,
        status: 'unparsed',
      };
    }
  });
};

export const findEarliestCertificateExpiry = (
  summaries: SamlCertificateSummary[],
): string | null => {
  const expiries = summaries
    .map((summary) => summary.validTo)
    .filter((value): value is string => Boolean(value))
    .sort(
      (left, right) => new Date(left).getTime() - new Date(right).getTime(),
    );
  return expiries[0] || null;
};

export const normalizeSigningCertificatePem = (certificate: string) => {
  const trimmed = certificate.trim();
  if (!trimmed) {
    return null;
  }
  if (/BEGIN (CERTIFICATE|PUBLIC KEY)/.test(trimmed)) {
    return `${trimmed.replace(/\r\n/g, '\n')}\n`;
  }
  const normalized = trimmed.replace(/\s+/g, '');
  if (!normalized) {
    return null;
  }
  return `-----BEGIN CERTIFICATE-----\n${normalized.match(/.{1,64}/g)?.join('\n') || normalized}\n-----END CERTIFICATE-----\n`;
};

export const buildSamlAuthnRequest = ({
  requestId,
  redirectUri,
  entryPoint,
  serviceProviderIssuer,
  nameIdFormat,
  issueInstant,
}: {
  requestId: string;
  redirectUri: string;
  entryPoint: string;
  serviceProviderIssuer: string;
  nameIdFormat?: string;
  issueInstant: string;
}) => {
  const nameIdPolicy = nameIdFormat
    ? `<samlp:NameIDPolicy AllowCreate="true" Format="${xmlEscape(nameIdFormat)}" />`
    : '<samlp:NameIDPolicy AllowCreate="true" />';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${xmlEscape(requestId)}" Version="2.0" IssueInstant="${xmlEscape(issueInstant)}" Destination="${xmlEscape(entryPoint)}" AssertionConsumerServiceURL="${xmlEscape(redirectUri)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${xmlEscape(serviceProviderIssuer)}</saml:Issuer>${nameIdPolicy}</samlp:AuthnRequest>`;
};
