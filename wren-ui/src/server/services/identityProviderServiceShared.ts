import crypto from 'crypto';
import { IdentityProviderConfig } from '@server/repositories';
import { AuthResult } from './authService';

export type BaseIdentityProviderConfig = {
  groupRoleMappings?: Array<{ group: string; roleKey: string }>;
  autoProvision?: boolean;
  scimBearerToken?: string;
};

export type OIDCProviderConfig = BaseIdentityProviderConfig & {
  issuer?: string;
  clientId?: string;
  clientSecret?: string | null;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  scope?: string;
  emailClaim?: string;
  nameClaim?: string;
  subjectClaim?: string;
  groupsClaim?: string;
};

export type SamlCertificateSummary = {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint256: string | null;
  source: 'certificate' | 'public_key';
  status: 'valid' | 'expiring_soon' | 'expired' | 'unparsed';
};

export type SAMLProviderConfig = BaseIdentityProviderConfig & {
  issuer?: string;
  entryPoint?: string;
  serviceProviderIssuer?: string;
  audience?: string;
  emailAttribute?: string;
  nameAttribute?: string;
  groupsAttribute?: string;
  nameIdFormat?: string;
  allowUnsignedResponse?: boolean;
  metadataXml?: string;
  metadataUrl?: string;
  metadataFetchedAt?: string;
  signingCertificates?: string[];
  signingCertificate?: string;
  x509Certificate?: string;
  certificate?: string;
  signingCertificateSummaries?: SamlCertificateSummary[];
  signingCertificateCount?: number;
  earliestCertificateExpiryAt?: string | null;
  metadataSource?: 'xml' | 'url' | null;
};

export type SSOClaims = {
  externalSubject: string;
  email: string | null;
  displayName: string;
  groups: string[];
  issuer?: string | null;
};

export interface CreateIdentityProviderInput {
  workspaceId: string;
  providerType: string;
  name: string;
  enabled?: boolean;
  configJson?: Record<string, any> | null;
  createdBy?: string | null;
}

export interface UpdateIdentityProviderInput {
  workspaceId: string;
  id: string;
  name?: string;
  enabled?: boolean;
  configJson?: Record<string, any> | null;
}

export interface IdentityProviderPublicView extends IdentityProviderConfig {
  configJson?: Record<string, any> | null;
}

export interface StartWorkspaceSSOResult {
  authorizeUrl: string;
  provider: IdentityProviderPublicView;
  workspace: {
    id: string;
    slug?: string | null;
    name: string;
  };
}

export interface IIdentityProviderService {
  listProviders(workspaceId: string): Promise<IdentityProviderPublicView[]>;
  createProvider(
    input: CreateIdentityProviderInput,
  ): Promise<IdentityProviderPublicView>;
  updateProvider(
    input: UpdateIdentityProviderInput,
  ): Promise<IdentityProviderPublicView>;
  deleteProvider(workspaceId: string, id: string): Promise<void>;
  startWorkspaceSSO(input: {
    workspaceSlug: string;
    origin: string;
    redirectTo?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<StartWorkspaceSSOResult>;
  completeWorkspaceSSO(input: {
    state?: string;
    relayState?: string;
    code?: string;
    samlResponse?: string;
    origin: string;
  }): Promise<AuthResult>;
}

export type XMLTextNode = {
  kind: 'text';
  text: string;
  parent: XMLElementNode | null;
};

export type XMLElementNode = {
  kind: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XMLNode[];
  parent: XMLElementNode | null;
  namespaceMap: Record<string, string>;
  declaredNamespaces: Record<string, string>;
};

export type XMLNode = XMLTextNode | XMLElementNode;

export type SamlSignatureVerificationResult = {
  signedElementName: 'Response' | 'Assertion';
  signedElementId: string;
};

export const rolePriority: Record<string, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const SAML_ALLOWED_CANONICALIZATION_ALGORITHMS = new Set([
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);

export const SAML_ALLOWED_SIGNATURE_METHODS: Record<string, string> = {
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': 'RSA-SHA256',
  'http://www.w3.org/2000/09/xmldsig#rsa-sha1': 'RSA-SHA1',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': 'RSA-SHA512',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384': 'RSA-SHA384',
};

export const SAML_ALLOWED_DIGEST_METHODS: Record<string, string> = {
  'http://www.w3.org/2001/04/xmlenc#sha256': 'sha256',
  'http://www.w3.org/2000/09/xmldsig#sha1': 'sha1',
  'http://www.w3.org/2001/04/xmlenc#sha512': 'sha512',
  'http://www.w3.org/2001/04/xmldsig-more#sha384': 'sha384',
};

export const SAML_ALLOWED_REFERENCE_TRANSFORMS = new Set([
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);

export const SAML_HTTP_REDIRECT_BINDING =
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
export const SAML_HTTP_POST_BINDING =
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
export const SAML_CERTIFICATE_EXPIRY_WARNING_DAYS = 30;
export const SAML_METADATA_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const DERIVED_PROVIDER_CONFIG_KEYS = [
  'hasClientSecret',
  'hasScimBearerToken',
  'signingCertificateSummaries',
  'signingCertificateCount',
  'earliestCertificateExpiryAt',
  'metadataSource',
] as const;

export const base64UrlEncode = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const sha256Base64Url = (value: string) =>
  base64UrlEncode(crypto.createHash('sha256').update(value).digest());

export const normalizeGroupMappings = (
  mappings: BaseIdentityProviderConfig['groupRoleMappings'],
) =>
  Array.isArray(mappings)
    ? mappings
        .filter((item) => item?.group && item?.roleKey)
        .map((item) => ({
          group: String(item.group).trim(),
          roleKey: String(item.roleKey).trim().toLowerCase(),
        }))
    : [];

export const getClaimValue = (
  claims: Record<string, any>,
  claimName: string,
): string | null => {
  const value = claims[claimName];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
};

export const getClaimStringArray = (
  claims: Record<string, any>,
  claimName: string,
): string[] => {
  const value = claims[claimName];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

export const decodeJwtPayload = (
  token?: string | null,
): Record<string, any> | null => {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

export const buildProviderSubject = (
  providerId: string,
  externalSubject: string,
) => `${providerId}#${externalSubject}`;

export const isMaskedSecretPlaceholder = (value: unknown) =>
  typeof value === 'string' && /^•+$/.test(value.trim());

export const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const ensureArray = <T>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : [];

export const readAttributeArray = (
  attributeStatement: any,
  candidateNames: string[],
): string[] => {
  const statements = ensureArray(attributeStatement);
  const attributes = statements.flatMap((statement) =>
    ensureArray(statement?.Attribute),
  );

  for (const candidateName of candidateNames) {
    const matched = attributes.find((attribute) => {
      const names = [attribute?.Name, attribute?.FriendlyName]
        .filter(Boolean)
        .map((item: string) => String(item).trim());
      return names.includes(candidateName);
    });
    if (!matched) {
      continue;
    }

    const values = ensureArray(matched.AttributeValue)
      .map((item) => {
        if (item == null) {
          return '';
        }
        if (typeof item === 'string') {
          return item.trim();
        }
        if (typeof item === 'object' && '#text' in item) {
          return String(item['#text'] || '').trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
    if (values.length > 0) {
      return values;
    }
  }

  return [];
};

export const readAttributeValue = (
  attributeStatement: any,
  candidateNames: string[],
): string | null =>
  readAttributeArray(attributeStatement, candidateNames)[0] || null;

export const getXmlNamePrefix = (name: string) => {
  const separatorIndex = name.indexOf(':');
  return separatorIndex >= 0 ? name.slice(0, separatorIndex) : '';
};

export const getXmlLocalName = (name: string) => {
  const separatorIndex = name.indexOf(':');
  return separatorIndex >= 0 ? name.slice(separatorIndex + 1) : name;
};

export const getXmlNamespaceDeclarationPrefix = (name: string) => {
  if (name === 'xmlns') {
    return '';
  }
  return name.startsWith('xmlns:') ? name.slice(6) : null;
};

export const escapeCanonicalXmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

export const escapeCanonicalXmlText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');

export const normalizeCertificateArray = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

export const stripDerivedProviderConfigFields = (
  configJson: Record<string, any>,
) => {
  const sanitized = { ...configJson };
  for (const key of DERIVED_PROVIDER_CONFIG_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
};

export const mergeConfigJson = (
  existing: IdentityProviderConfig,
  nextConfig?: Record<string, any> | null,
) => {
  const currentConfig = stripDerivedProviderConfigFields(
    existing.configJson || {},
  );
  if (nextConfig === undefined) {
    return currentConfig;
  }

  const merged = {
    ...currentConfig,
    ...stripDerivedProviderConfigFields(nextConfig || {}),
  } as Record<string, any>;

  for (const secretKey of ['clientSecret', 'scimBearerToken']) {
    if (Object.prototype.hasOwnProperty.call(nextConfig || {}, secretKey)) {
      const candidate = (nextConfig as Record<string, any>)[secretKey];
      if (isMaskedSecretPlaceholder(candidate)) {
        merged[secretKey] = currentConfig[secretKey];
      } else if (candidate === '') {
        merged[secretKey] = null;
      } else {
        merged[secretKey] = candidate;
      }
    } else if (secretKey in currentConfig) {
      merged[secretKey] = currentConfig[secretKey];
    }
  }

  return merged;
};

export const readOidcConfig = (
  provider: IdentityProviderConfig,
): OIDCProviderConfig => {
  const configJson = (provider.configJson || {}) as OIDCProviderConfig;
  if (provider.providerType !== 'oidc') {
    throw new Error('Provider is not an OIDC identity provider');
  }
  if (!configJson.clientId) {
    throw new Error('OIDC clientId is required');
  }
  return configJson;
};

export const readSamlConfig = (
  provider: IdentityProviderConfig,
): SAMLProviderConfig => {
  const configJson = (provider.configJson || {}) as SAMLProviderConfig;
  if (provider.providerType !== 'saml') {
    throw new Error('Provider is not a SAML identity provider');
  }
  if (!configJson.entryPoint) {
    throw new Error('SAML entryPoint is required');
  }
  return configJson;
};
