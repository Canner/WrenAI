import crypto from 'crypto';
import { deflateRawSync } from 'zlib';
import {
  AuthIdentity,
  IAuthIdentityRepository,
  IIdentityProviderConfigRepository,
  ISSOSessionRepository,
  IUserRepository,
  IWorkspaceRepository,
  IdentityProviderConfig,
} from '@server/repositories';
import { IAuthService, AuthResult } from './authService';
import { IWorkspaceService } from './workspaceService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { XMLParser } = require('fast-xml-parser');

type BaseIdentityProviderConfig = {
  groupRoleMappings?: Array<{ group: string; roleKey: string }>;
  autoProvision?: boolean;
  scimBearerToken?: string;
};

type OIDCProviderConfig = BaseIdentityProviderConfig & {
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

type SAMLProviderConfig = BaseIdentityProviderConfig & {
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

type SamlCertificateSummary = {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint256: string | null;
  source: 'certificate' | 'public_key';
  status: 'valid' | 'expiring_soon' | 'expired' | 'unparsed';
};

type SSOClaims = {
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

const base64UrlEncode = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const sha256Base64Url = (value: string) =>
  base64UrlEncode(crypto.createHash('sha256').update(value).digest());

const normalizeGroupMappings = (
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

const rolePriority: Record<string, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

const getClaimValue = (
  claims: Record<string, any>,
  claimName: string,
): string | null => {
  const value = claims[claimName];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
};

const getClaimStringArray = (
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

const decodeJwtPayload = (
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

const buildProviderSubject = (providerId: string, externalSubject: string) =>
  `${providerId}#${externalSubject}`;

const isMaskedSecretPlaceholder = (value: unknown) =>
  typeof value === 'string' && /^•+$/.test(value.trim());

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const ensureArray = <T>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : [];

const readAttributeArray = (
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

const readAttributeValue = (
  attributeStatement: any,
  candidateNames: string[],
): string | null =>
  readAttributeArray(attributeStatement, candidateNames)[0] || null;

type XMLTextNode = {
  kind: 'text';
  text: string;
  parent: XMLElementNode | null;
};

type XMLElementNode = {
  kind: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XMLNode[];
  parent: XMLElementNode | null;
  namespaceMap: Record<string, string>;
  declaredNamespaces: Record<string, string>;
};

type XMLNode = XMLTextNode | XMLElementNode;

type SamlSignatureVerificationResult = {
  signedElementName: 'Response' | 'Assertion';
  signedElementId: string;
};

const SAML_ALLOWED_CANONICALIZATION_ALGORITHMS = new Set([
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);
const SAML_ALLOWED_SIGNATURE_METHODS: Record<string, string> = {
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': 'RSA-SHA256',
  'http://www.w3.org/2000/09/xmldsig#rsa-sha1': 'RSA-SHA1',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': 'RSA-SHA512',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384': 'RSA-SHA384',
};
const SAML_ALLOWED_DIGEST_METHODS: Record<string, string> = {
  'http://www.w3.org/2001/04/xmlenc#sha256': 'sha256',
  'http://www.w3.org/2000/09/xmldsig#sha1': 'sha1',
  'http://www.w3.org/2001/04/xmlenc#sha512': 'sha512',
  'http://www.w3.org/2001/04/xmldsig-more#sha384': 'sha384',
};
const SAML_ALLOWED_REFERENCE_TRANSFORMS = new Set([
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);
const SAML_HTTP_REDIRECT_BINDING =
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const SAML_HTTP_POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const SAML_CERTIFICATE_EXPIRY_WARNING_DAYS = 30;
const SAML_METADATA_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const getXmlNamePrefix = (name: string) => {
  const separatorIndex = name.indexOf(':');
  return separatorIndex >= 0 ? name.slice(0, separatorIndex) : '';
};

const getXmlLocalName = (name: string) => {
  const separatorIndex = name.indexOf(':');
  return separatorIndex >= 0 ? name.slice(separatorIndex + 1) : name;
};

const getXmlNamespaceDeclarationPrefix = (name: string) => {
  if (name === 'xmlns') {
    return '';
  }
  return name.startsWith('xmlns:') ? name.slice(6) : null;
};

const escapeCanonicalXmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

const escapeCanonicalXmlText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');

const normalizeCertificateArray = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const DERIVED_PROVIDER_CONFIG_KEYS = [
  'hasClientSecret',
  'hasScimBearerToken',
  'signingCertificateSummaries',
  'signingCertificateCount',
  'earliestCertificateExpiryAt',
  'metadataSource',
] as const;

export class IdentityProviderService implements IIdentityProviderService {
  constructor(
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly userRepository: IUserRepository,
    private readonly authIdentityRepository: IAuthIdentityRepository,
    private readonly identityProviderConfigRepository: IIdentityProviderConfigRepository,
    private readonly ssoSessionRepository: ISSOSessionRepository,
    private readonly workspaceService: IWorkspaceService,
    private readonly authService: IAuthService,
  ) {}

  public async listProviders(workspaceId: string) {
    const providers = await this.identityProviderConfigRepository.findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    );
    return providers.map((provider) => this.toPublicProvider(provider));
  }

  public async createProvider(input: CreateIdentityProviderInput) {
    await this.requireWorkspaceById(input.workspaceId);
    const providerType = String(input.providerType || 'oidc')
      .trim()
      .toLowerCase();
    const normalizedConfigJson = await this.normalizeProviderConfigJson(
      providerType,
      input.configJson || null,
    );
    const provider = await this.identityProviderConfigRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      providerType,
      name: input.name.trim(),
      enabled: Boolean(input.enabled),
      configJson: normalizedConfigJson,
      createdBy: input.createdBy || null,
    });

    return this.toPublicProvider(provider);
  }

  public async updateProvider(input: UpdateIdentityProviderInput) {
    const existing = await this.requireProvider(input.workspaceId, input.id);
    const nextConfigJson = await this.normalizeProviderConfigJson(
      existing.providerType,
      this.mergeConfigJson(existing, input.configJson),
    );
    const provider = await this.identityProviderConfigRepository.updateOne(
      existing.id,
      {
        name: input.name?.trim() || existing.name,
        enabled:
          input.enabled === undefined
            ? existing.enabled
            : Boolean(input.enabled),
        configJson: nextConfigJson,
      },
    );

    return this.toPublicProvider(provider);
  }

  public async deleteProvider(workspaceId: string, id: string) {
    await this.requireProvider(workspaceId, id);
    await this.identityProviderConfigRepository.deleteOne(id);
  }

  public async startWorkspaceSSO(input: {
    workspaceSlug: string;
    origin: string;
    redirectTo?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    const workspace = await this.workspaceRepository.findOneBy({
      slug: input.workspaceSlug,
    });
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const provider = await this.findEnabledProvider(workspace.id);
    const state = base64UrlEncode(crypto.randomBytes(24));
    const redirectUri = `${input.origin}/api/auth/sso/callback`;

    if (provider.providerType === 'oidc') {
      const providerConfig = this.readOidcConfig(provider);
      const authorizationEndpoint =
        await this.resolveAuthorizationEndpoint(providerConfig);
      const nonce = base64UrlEncode(crypto.randomBytes(24));
      const codeVerifier = base64UrlEncode(crypto.randomBytes(48));
      const codeChallenge = sha256Base64Url(codeVerifier);

      await this.ssoSessionRepository.createOne({
        id: crypto.randomUUID(),
        state,
        workspaceId: workspace.id,
        identityProviderConfigId: provider.id,
        redirectTo: input.redirectTo || null,
        codeVerifier,
        nonce,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      });

      const url = new URL(authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', providerConfig.clientId || '');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set(
        'scope',
        providerConfig.scope || 'openid profile email',
      );
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');

      return {
        authorizeUrl: url.toString(),
        provider: this.toPublicProvider(provider),
        workspace: {
          id: workspace.id,
          slug: workspace.slug || null,
          name: workspace.name,
        },
      };
    }

    const providerConfig = this.readSamlConfig(provider);
    const requestId = `_${crypto.randomBytes(20).toString('hex')}`;
    const samlRequest = this.buildSamlAuthnRequest({
      requestId,
      redirectUri,
      entryPoint: providerConfig.entryPoint!,
      serviceProviderIssuer:
        providerConfig.serviceProviderIssuer || `${input.origin}/wrenai`,
      nameIdFormat: providerConfig.nameIdFormat,
      issueInstant: new Date().toISOString(),
    });

    await this.ssoSessionRepository.createOne({
      id: crypto.randomUUID(),
      state,
      workspaceId: workspace.id,
      identityProviderConfigId: provider.id,
      redirectTo: input.redirectTo || null,
      codeVerifier: requestId,
      nonce: base64UrlEncode(crypto.randomBytes(24)),
      providerRequestId: requestId,
      providerStateJson: {
        redirectUri,
        providerType: 'saml',
      },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    const deflatedRequest = deflateRawSync(
      Buffer.from(samlRequest, 'utf8'),
    ).toString('base64');
    const url = new URL(providerConfig.entryPoint!);
    url.searchParams.set('SAMLRequest', deflatedRequest);
    url.searchParams.set('RelayState', state);

    return {
      authorizeUrl: url.toString(),
      provider: this.toPublicProvider(provider),
      workspace: {
        id: workspace.id,
        slug: workspace.slug || null,
        name: workspace.name,
      },
    };
  }

  public async completeWorkspaceSSO(input: {
    state?: string;
    relayState?: string;
    code?: string;
    samlResponse?: string;
    origin: string;
  }) {
    const state = input.state || input.relayState;
    if (!state) {
      throw new Error('SSO state is required');
    }

    const ssoSession = await this.ssoSessionRepository.findOneBy({ state });
    if (!ssoSession) {
      throw new Error('SSO session not found');
    }
    if (ssoSession.consumedAt) {
      throw new Error('SSO session already consumed');
    }
    if (new Date(ssoSession.expiresAt).getTime() <= Date.now()) {
      throw new Error('SSO session expired');
    }

    const provider = await this.maybeRefreshSamlMetadataProvider(
      await this.requireProvider(
        ssoSession.workspaceId,
        ssoSession.identityProviderConfigId,
      ),
    );

    const claims =
      provider.providerType === 'oidc'
        ? await this.completeOidcSSO({
            provider,
            ssoSession,
            code: input.code,
            origin: input.origin,
          })
        : await this.completeSamlSSO({
            provider,
            ssoSession,
            samlResponse: input.samlResponse,
            origin: input.origin,
          });

    return await this.completeProvisionedIdentity({
      ssoSession,
      provider,
      claims,
    });
  }

  private async completeOidcSSO({
    provider,
    ssoSession,
    code,
    origin,
  }: {
    provider: IdentityProviderConfig;
    ssoSession: any;
    code?: string;
    origin: string;
  }): Promise<SSOClaims> {
    if (!code) {
      throw new Error('OIDC code is required');
    }
    const oidcConfig = this.readOidcConfig(provider);
    const redirectUri = `${origin}/api/auth/sso/callback`;
    const tokenResponse = await this.exchangeCodeForTokens({
      providerConfig: oidcConfig,
      code,
      codeVerifier: ssoSession.codeVerifier,
      redirectUri,
    });

    const claims = await this.loadUserClaims({
      providerConfig: oidcConfig,
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
    });
    const subjectClaim = oidcConfig.subjectClaim || 'sub';
    const externalSubject = getClaimValue(claims, subjectClaim);
    if (!externalSubject) {
      throw new Error('OIDC subject claim is required');
    }

    const email = getClaimValue(claims, oidcConfig.emailClaim || 'email');
    const displayName =
      getClaimValue(claims, oidcConfig.nameClaim || 'name') ||
      email ||
      'Workspace User';
    const groups = getClaimStringArray(
      claims,
      oidcConfig.groupsClaim || 'groups',
    );

    return {
      externalSubject,
      email,
      displayName,
      groups,
      issuer: oidcConfig.issuer || null,
    };
  }

  private async completeSamlSSO({
    provider,
    ssoSession,
    samlResponse,
    origin,
  }: {
    provider: IdentityProviderConfig;
    ssoSession: any;
    samlResponse?: string;
    origin: string;
  }): Promise<SSOClaims> {
    if (!samlResponse) {
      throw new Error('SAMLResponse is required');
    }
    const samlConfig = this.readSamlConfig(provider);
    const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    const responseTree = this.parseXmlTree(xml);
    if (getXmlLocalName(responseTree.name) !== 'Response') {
      throw new Error('Unexpected SAML payload root');
    }
    const signatureVerification =
      samlConfig.allowUnsignedResponse === true
        ? null
        : this.verifySamlSignature(responseTree, samlConfig);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      trimValues: true,
      parseTagValue: true,
    });
    const parsed = parser.parse(xml);
    const response = parsed?.Response || parsed?.EncryptedAssertion || parsed;
    const responseRoot = response?.Response || response;
    const responseIssuer =
      typeof responseRoot?.Issuer === 'string'
        ? responseRoot.Issuer
        : responseRoot?.Issuer?.['#text'] || null;
    if (
      samlConfig.issuer &&
      responseIssuer &&
      responseIssuer !== samlConfig.issuer
    ) {
      throw new Error('Unexpected SAML issuer');
    }

    const statusCode =
      responseRoot?.Status?.StatusCode?.Value ||
      responseRoot?.StatusCode?.Value ||
      null;
    if (
      statusCode &&
      statusCode !== 'urn:oasis:names:tc:SAML:2.0:status:Success'
    ) {
      throw new Error('SAML authentication failed');
    }

    const inResponseTo = responseRoot?.InResponseTo || null;
    if (
      ssoSession.providerRequestId &&
      inResponseTo &&
      inResponseTo !== ssoSession.providerRequestId
    ) {
      throw new Error('SAML response does not match the pending request');
    }

    const destination = responseRoot?.Destination || null;
    const expectedDestination = `${origin}/api/auth/sso/callback`;
    if (destination && destination !== expectedDestination) {
      throw new Error('Unexpected SAML destination');
    }

    const assertions = ensureArray(responseRoot?.Assertion);
    const assertion =
      signatureVerification?.signedElementName === 'Assertion'
        ? assertions.find(
            (candidate) =>
              (candidate?.ID || candidate?.Id || candidate?.id) ===
              signatureVerification.signedElementId,
          ) || assertions[0]
        : assertions[0];
    if (!assertion) {
      throw new Error('SAML assertion is missing');
    }
    if (
      signatureVerification?.signedElementName === 'Response' &&
      assertions.length !== 1
    ) {
      throw new Error(
        'Signed SAML response must contain exactly one assertion',
      );
    }

    this.assertSamlTimeWindow({
      notBefore: assertion?.Conditions?.NotBefore || null,
      notOnOrAfter: assertion?.Conditions?.NotOnOrAfter || null,
      label: 'SAML assertion conditions',
    });

    const audience = ensureArray(
      assertion?.Conditions?.AudienceRestriction,
    ).flatMap((restriction) => ensureArray(restriction?.Audience))[0];
    if (samlConfig.audience && audience && audience !== samlConfig.audience) {
      throw new Error('Unexpected SAML audience');
    }

    const subjectConfirmationData = ensureArray(
      assertion?.Subject?.SubjectConfirmation,
    ).flatMap((confirmation) =>
      ensureArray(confirmation?.SubjectConfirmationData),
    )[0];
    if (
      subjectConfirmationData?.Recipient &&
      subjectConfirmationData.Recipient !== expectedDestination
    ) {
      throw new Error('Unexpected SAML subject confirmation recipient');
    }
    if (
      ssoSession.providerRequestId &&
      subjectConfirmationData?.InResponseTo &&
      subjectConfirmationData.InResponseTo !== ssoSession.providerRequestId
    ) {
      throw new Error('Unexpected SAML subject confirmation request');
    }
    this.assertSamlTimeWindow({
      notOnOrAfter: subjectConfirmationData?.NotOnOrAfter || null,
      label: 'SAML subject confirmation',
    });

    const nameIdValue =
      assertion?.Subject?.NameID?.['#text'] ||
      assertion?.Subject?.NameID ||
      null;
    if (!nameIdValue || typeof nameIdValue !== 'string') {
      throw new Error('SAML NameID is required');
    }

    const email =
      readAttributeValue(assertion?.AttributeStatement, [
        samlConfig.emailAttribute || 'email',
        'mail',
        'Email',
        'emailAddress',
      ]) || null;
    const displayName =
      readAttributeValue(assertion?.AttributeStatement, [
        samlConfig.nameAttribute || 'displayName',
        'name',
        'displayName',
        'cn',
      ]) ||
      email ||
      nameIdValue;
    const groups = readAttributeArray(assertion?.AttributeStatement, [
      samlConfig.groupsAttribute || 'groups',
      'memberOf',
      'roles',
    ]);

    return {
      externalSubject: String(nameIdValue).trim(),
      email,
      displayName,
      groups,
      issuer: responseIssuer || samlConfig.issuer || null,
    };
  }

  private async completeProvisionedIdentity({
    ssoSession,
    provider,
    claims,
  }: {
    ssoSession: any;
    provider: IdentityProviderConfig;
    claims: SSOClaims;
  }) {
    const providerSubject = buildProviderSubject(
      provider.id,
      claims.externalSubject,
    );

    const tx = await this.userRepository.transaction();
    let authIdentity: AuthIdentity;
    let userId: string;

    try {
      authIdentity =
        (await this.authIdentityRepository.findOneBy(
          {
            identityProviderConfigId: provider.id,
            externalSubject: claims.externalSubject,
          },
          { tx },
        )) ||
        (await this.authIdentityRepository.findOneBy(
          {
            providerType: provider.providerType,
            providerSubject,
          },
          { tx },
        ))!;

      let user =
        authIdentity &&
        (await this.userRepository.findOneBy(
          { id: authIdentity.userId },
          { tx },
        ));

      if (!user && claims.email) {
        user = await this.userRepository.findOneBy(
          { email: claims.email.toLowerCase() },
          { tx },
        );
      }

      const config =
        provider.providerType === 'oidc'
          ? this.readOidcConfig(provider)
          : this.readSamlConfig(provider);
      const autoProvision = config.autoProvision !== false;
      if (!user && !autoProvision) {
        throw new Error(
          'User provisioning is disabled for this identity provider',
        );
      }

      if (!user) {
        if (!claims.email) {
          throw new Error('SSO email claim is required for auto provisioning');
        }

        user = await this.userRepository.createOne(
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
        user = await this.userRepository.updateOne(
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
        authIdentity = await this.authIdentityRepository.updateOne(
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
        authIdentity = await this.authIdentityRepository.createOne(
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
        await this.userRepository.updateOne(
          user.id,
          { defaultWorkspaceId: ssoSession.workspaceId },
          { tx },
        );
      }

      await this.ssoSessionRepository.updateOne(
        ssoSession.id,
        { consumedAt: new Date() },
        { tx },
      );

      await this.userRepository.commit(tx);
    } catch (error) {
      await this.userRepository.rollback(tx);
      throw error;
    }

    const config =
      provider.providerType === 'oidc'
        ? this.readOidcConfig(provider)
        : this.readSamlConfig(provider);
    const desiredRoleKey = this.resolveMappedRoleKey(
      claims.groups,
      normalizeGroupMappings(config.groupRoleMappings),
    );

    const existingMembership = await this.workspaceService.getMembership(
      ssoSession.workspaceId,
      userId,
    );
    await this.workspaceService.addMember({
      workspaceId: ssoSession.workspaceId,
      userId,
      roleKey: desiredRoleKey || existingMembership?.roleKey || 'member',
      status: 'active',
    });

    return this.authService.issueSessionForIdentity({
      userId,
      authIdentityId: authIdentity.id,
      workspaceId: ssoSession.workspaceId,
    });
  }

  private async requireWorkspaceById(workspaceId: string) {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  private async requireProvider(workspaceId: string, id: string) {
    const provider = await this.identityProviderConfigRepository.findOneBy({
      id,
    });
    if (!provider || provider.workspaceId !== workspaceId) {
      throw new Error('Identity provider not found');
    }
    return provider;
  }

  private async findEnabledProvider(workspaceId: string) {
    const providers = await this.identityProviderConfigRepository.findAllBy(
      { workspaceId, enabled: true },
      { order: 'created_at asc' },
    );
    const provider =
      providers.find((item) => item.providerType === 'oidc') || providers[0];
    if (!provider) {
      throw new Error('Workspace enterprise SSO is not configured');
    }
    return this.maybeRefreshSamlMetadataProvider(provider);
  }

  private toPublicProvider(
    provider: IdentityProviderConfig,
  ): IdentityProviderPublicView {
    const configJson = { ...(provider.configJson || {}) };
    if (provider.providerType === 'saml') {
      const samlConfig = configJson as SAMLProviderConfig;
      const signingCertificateSummaries =
        this.buildSamlCertificateSummaries(samlConfig);
      configJson.signingCertificateSummaries = signingCertificateSummaries;
      configJson.signingCertificateCount = signingCertificateSummaries.length;
      configJson.earliestCertificateExpiryAt =
        this.findEarliestCertificateExpiry(signingCertificateSummaries);
      configJson.metadataSource = samlConfig.metadataUrl
        ? 'url'
        : samlConfig.metadataXml
          ? 'xml'
          : null;
    }
    if ('clientSecret' in configJson) {
      configJson.clientSecret = configJson.clientSecret ? '••••••••' : '';
      configJson.hasClientSecret = Boolean(provider.configJson?.clientSecret);
    }
    if ('scimBearerToken' in configJson) {
      configJson.scimBearerToken = configJson.scimBearerToken ? '••••••••' : '';
      configJson.hasScimBearerToken = Boolean(
        provider.configJson?.scimBearerToken,
      );
    }

    return {
      ...provider,
      configJson,
    };
  }

  private mergeConfigJson(
    existing: IdentityProviderConfig,
    nextConfig?: Record<string, any> | null,
  ) {
    const currentConfig = this.stripDerivedProviderConfigFields(
      existing.configJson || {},
    );
    if (nextConfig === undefined) {
      return currentConfig;
    }
    const merged = {
      ...currentConfig,
      ...this.stripDerivedProviderConfigFields(nextConfig || {}),
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
  }

  private readOidcConfig(provider: IdentityProviderConfig): OIDCProviderConfig {
    const configJson = (provider.configJson || {}) as OIDCProviderConfig;
    if (provider.providerType !== 'oidc') {
      throw new Error('Provider is not an OIDC identity provider');
    }
    if (!configJson.clientId) {
      throw new Error('OIDC clientId is required');
    }
    return configJson;
  }

  private readSamlConfig(provider: IdentityProviderConfig): SAMLProviderConfig {
    const configJson = (provider.configJson || {}) as SAMLProviderConfig;
    if (provider.providerType !== 'saml') {
      throw new Error('Provider is not a SAML identity provider');
    }
    if (!configJson.entryPoint) {
      throw new Error('SAML entryPoint is required');
    }
    return configJson;
  }

  private parseXmlTree(xml: string): XMLElementNode {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      preserveOrder: true,
      trimValues: false,
      parseTagValue: false,
      removeNSPrefix: false,
    });
    const orderedNodes = parser.parse(xml);
    const elementNodes = ensureArray(orderedNodes)
      .map((entry) => this.buildXmlNodeFromOrderedEntry(entry, null, {}))
      .filter(Boolean) as XMLElementNode[];
    const rootNode = elementNodes.find((node) => node.kind === 'element');
    if (!rootNode) {
      throw new Error('SAML XML root element is missing');
    }
    return rootNode;
  }

  private buildXmlNodeFromOrderedEntry(
    entry: Record<string, any>,
    parent: XMLElementNode | null,
    inheritedNamespaces: Record<string, string>,
  ): XMLNode | null {
    const [name] = Object.keys(entry || {}).filter((key) => key !== ':@');
    if (!name) {
      return null;
    }
    if (name === '#text') {
      return {
        kind: 'text',
        text: String(entry['#text'] || ''),
        parent,
      };
    }
    if (name.startsWith('?')) {
      return null;
    }

    const attrs = Object.fromEntries(
      Object.entries(entry[':@'] || {}).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    );
    const declaredNamespaces = Object.entries(attrs).reduce(
      (result, [attrName, value]) => {
        const prefix = getXmlNamespaceDeclarationPrefix(attrName);
        if (prefix == null) {
          return result;
        }
        result[prefix] = value;
        return result;
      },
      {} as Record<string, string>,
    );
    const node: XMLElementNode = {
      kind: 'element',
      name,
      attrs,
      children: [],
      parent,
      declaredNamespaces,
      namespaceMap: {
        ...inheritedNamespaces,
        ...declaredNamespaces,
      },
    };

    const childEntries = ensureArray(entry[name]);
    node.children = childEntries
      .map((childEntry) =>
        this.buildXmlNodeFromOrderedEntry(childEntry, node, node.namespaceMap),
      )
      .filter(Boolean) as XMLNode[];

    return node;
  }

  private getElementChildren(node: XMLElementNode) {
    return node.children.filter(
      (child): child is XMLElementNode => child.kind === 'element',
    );
  }

  private findFirstChildElement(
    node: XMLElementNode,
    predicate: (child: XMLElementNode) => boolean,
  ) {
    return this.getElementChildren(node).find(predicate) || null;
  }

  private findDescendantElements(
    node: XMLElementNode,
    predicate: (child: XMLElementNode) => boolean,
  ): XMLElementNode[] {
    const matches: XMLElementNode[] = [];
    for (const child of this.getElementChildren(node)) {
      if (predicate(child)) {
        matches.push(child);
      }
      matches.push(...this.findDescendantElements(child, predicate));
    }
    return matches;
  }

  private findElementById(
    node: XMLElementNode,
    id: string,
  ): XMLElementNode | null {
    if ((node.attrs.ID || node.attrs.Id || node.attrs.id) === id) {
      return node;
    }
    for (const child of this.getElementChildren(node)) {
      const matched = this.findElementById(child, id);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  private readNodeText(node: XMLElementNode | null): string | null {
    if (!node) {
      return null;
    }
    const value = node.children
      .map((child) =>
        child.kind === 'text' ? child.text : this.readNodeText(child) || '',
      )
      .join('')
      .trim();
    return value || null;
  }

  private canonicalizeXmlNode(
    node: XMLElementNode,
    options?: {
      excludeNode?: XMLElementNode | null;
      renderedNamespaces?: Record<string, string>;
    },
  ): string {
    if (options?.excludeNode && node === options.excludeNode) {
      return '';
    }

    const renderedNamespaces = { ...(options?.renderedNamespaces || {}) };
    const namespaceEntries: Array<[string, string]> = [];
    const visiblePrefixes = new Set<string>([getXmlNamePrefix(node.name)]);
    const attributeEntries = Object.entries(node.attrs).filter(
      ([attrName]) => getXmlNamespaceDeclarationPrefix(attrName) == null,
    );
    for (const [attrName] of attributeEntries) {
      const attrPrefix = getXmlNamePrefix(attrName);
      if (attrPrefix) {
        visiblePrefixes.add(attrPrefix);
      }
    }
    for (const prefix of visiblePrefixes) {
      if (prefix === 'xml') {
        continue;
      }
      const namespaceUri = node.namespaceMap[prefix];
      if (
        namespaceUri !== undefined &&
        renderedNamespaces[prefix] !== namespaceUri
      ) {
        namespaceEntries.push([prefix, namespaceUri]);
        renderedNamespaces[prefix] = namespaceUri;
      }
    }
    namespaceEntries.sort(([leftPrefix], [rightPrefix]) =>
      leftPrefix.localeCompare(rightPrefix),
    );

    const sortedAttributes = attributeEntries.sort(
      ([leftName], [rightName]) => {
        const leftPrefix = getXmlNamePrefix(leftName);
        const rightPrefix = getXmlNamePrefix(rightName);
        const leftNamespace = leftPrefix
          ? node.namespaceMap[leftPrefix] || ''
          : '';
        const rightNamespace = rightPrefix
          ? node.namespaceMap[rightPrefix] || ''
          : '';
        if (leftNamespace !== rightNamespace) {
          return leftNamespace.localeCompare(rightNamespace);
        }
        const leftLocal = getXmlLocalName(leftName);
        const rightLocal = getXmlLocalName(rightName);
        if (leftLocal !== rightLocal) {
          return leftLocal.localeCompare(rightLocal);
        }
        return leftName.localeCompare(rightName);
      },
    );

    const namespaceXml = namespaceEntries
      .map(([prefix, value]) =>
        prefix
          ? ` xmlns:${prefix}="${escapeCanonicalXmlAttribute(value)}"`
          : ` xmlns="${escapeCanonicalXmlAttribute(value)}"`,
      )
      .join('');
    const attributesXml = sortedAttributes
      .map(
        ([name, value]) =>
          ` ${name}="${escapeCanonicalXmlAttribute(String(value))}"`,
      )
      .join('');
    const childrenXml = node.children
      .map((child) =>
        child.kind === 'text'
          ? escapeCanonicalXmlText(child.text)
          : this.canonicalizeXmlNode(child, {
              excludeNode: options?.excludeNode || null,
              renderedNamespaces,
            }),
      )
      .join('');

    return `<${node.name}${namespaceXml}${attributesXml}>${childrenXml}</${node.name}>`;
  }

  private extractSamlMetadataConfig(
    metadataXml: string,
  ): Partial<SAMLProviderConfig> {
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
    const singleSignOnServices = ensureArray(
      idpDescriptor?.SingleSignOnService,
    );
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
  }

  private stripDerivedProviderConfigFields(configJson: Record<string, any>) {
    const sanitized = { ...configJson };
    for (const key of DERIVED_PROVIDER_CONFIG_KEYS) {
      delete sanitized[key];
    }
    return sanitized;
  }

  private isSamlMetadataRefreshStale(config: SAMLProviderConfig) {
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
  }

  private async maybeRefreshSamlMetadataProvider(
    provider: IdentityProviderConfig,
    options?: { force?: boolean; softFail?: boolean },
  ) {
    if (provider.providerType !== 'saml') {
      return provider;
    }

    const config = (provider.configJson || {}) as SAMLProviderConfig;
    if (!String(config.metadataUrl || '').trim()) {
      return provider;
    }
    if (!options?.force && !this.isSamlMetadataRefreshStale(config)) {
      return provider;
    }

    try {
      const nextConfigJson = await this.normalizeProviderConfigJson(
        provider.providerType,
        this.stripDerivedProviderConfigFields(provider.configJson || {}),
      );
      if (!nextConfigJson) {
        return provider;
      }
      return await this.identityProviderConfigRepository.updateOne(
        provider.id,
        {
          configJson: nextConfigJson,
        },
      );
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
  }

  private async fetchSamlMetadataXml(metadataUrl: string) {
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
  }

  private async normalizeSamlConfigJson(configJson: Record<string, any>) {
    const normalized = this.stripDerivedProviderConfigFields(configJson);
    const metadataUrl =
      typeof normalized.metadataUrl === 'string'
        ? normalized.metadataUrl.trim()
        : '';
    const shouldPreferFetchedMetadata = Boolean(metadataUrl);
    if (metadataUrl) {
      const fetchedMetadata = await this.fetchSamlMetadataXml(metadataUrl);
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
      const metadataConfig = this.extractSamlMetadataConfig(metadataXml);
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
  }

  private async normalizeProviderConfigJson(
    providerType: string,
    configJson?: Record<string, any> | null,
  ) {
    if (!configJson) {
      return null;
    }
    const sanitizedConfigJson =
      this.stripDerivedProviderConfigFields(configJson);
    if (providerType !== 'saml') {
      return sanitizedConfigJson;
    }
    return this.normalizeSamlConfigJson(sanitizedConfigJson);
  }

  private normalizeCertificateDate(value?: string | null) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  private buildSamlCertificateSummaries(
    config: SAMLProviderConfig,
  ): SamlCertificateSummary[] {
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
      const normalizedCertificate =
        this.normalizeSigningCertificatePem(certificate);
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
        const validTo = this.normalizeCertificateDate(x509.validTo);
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
          validFrom: this.normalizeCertificateDate(x509.validFrom),
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
  }

  private findEarliestCertificateExpiry(
    summaries: SamlCertificateSummary[],
  ): string | null {
    const expiries = summaries
      .map((summary) => summary.validTo)
      .filter((value): value is string => Boolean(value))
      .sort(
        (left, right) => new Date(left).getTime() - new Date(right).getTime(),
      );
    return expiries[0] || null;
  }

  private normalizeSigningCertificatePem(certificate: string) {
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
  }

  private resolveSamlVerificationKeys(config: SAMLProviderConfig) {
    const rawCertificates = normalizeCertificateArray([
      ...ensureArray(config.signingCertificates),
      config.signingCertificate,
      config.x509Certificate,
      config.certificate,
    ]);
    return rawCertificates
      .map((certificate) => this.normalizeSigningCertificatePem(certificate))
      .filter(Boolean)
      .map((normalizedCertificate) => {
        try {
          return crypto.createPublicKey(normalizedCertificate!);
        } catch {
          try {
            return new crypto.X509Certificate(normalizedCertificate!).publicKey;
          } catch {
            throw new Error('Invalid SAML signing certificate/public key');
          }
        }
      });
  }

  private verifySamlSignature(
    responseNode: XMLElementNode,
    config: SAMLProviderConfig,
  ): SamlSignatureVerificationResult {
    const verificationKeys = this.resolveSamlVerificationKeys(config);
    if (verificationKeys.length === 0) {
      throw new Error(
        'SAML signing certificate/public key is required unless allowUnsignedResponse=true',
      );
    }

    const assertionNodes = this.findDescendantElements(
      responseNode,
      (child) => getXmlLocalName(child.name) === 'Assertion',
    );
    const candidateNodes = [...assertionNodes, responseNode].filter(
      (candidate) =>
        Boolean(
          this.findFirstChildElement(
            candidate,
            (child) => getXmlLocalName(child.name) === 'Signature',
          ),
        ),
    );

    for (const candidateNode of candidateNodes) {
      const signatureNode = this.findFirstChildElement(
        candidateNode,
        (child) => getXmlLocalName(child.name) === 'Signature',
      );
      if (!signatureNode) {
        continue;
      }
      const signedInfoNode = this.findFirstChildElement(
        signatureNode,
        (child) => getXmlLocalName(child.name) === 'SignedInfo',
      );
      const signatureValueNode = this.findFirstChildElement(
        signatureNode,
        (child) => getXmlLocalName(child.name) === 'SignatureValue',
      );
      if (!signedInfoNode || !signatureValueNode) {
        continue;
      }

      const canonicalizationMethod = this.findFirstChildElement(
        signedInfoNode,
        (child) => getXmlLocalName(child.name) === 'CanonicalizationMethod',
      )?.attrs?.Algorithm;
      if (
        !canonicalizationMethod ||
        !SAML_ALLOWED_CANONICALIZATION_ALGORITHMS.has(canonicalizationMethod)
      ) {
        continue;
      }

      const signatureMethod = this.findFirstChildElement(
        signedInfoNode,
        (child) => getXmlLocalName(child.name) === 'SignatureMethod',
      )?.attrs?.Algorithm;
      const verifyAlgorithm = signatureMethod
        ? SAML_ALLOWED_SIGNATURE_METHODS[signatureMethod]
        : null;
      if (!verifyAlgorithm) {
        continue;
      }

      const referenceNodes = this.getElementChildren(signedInfoNode).filter(
        (child) => getXmlLocalName(child.name) === 'Reference',
      );
      if (referenceNodes.length === 0) {
        continue;
      }

      const candidateId =
        candidateNode.attrs.ID ||
        candidateNode.attrs.Id ||
        candidateNode.attrs.id;
      if (!candidateId) {
        continue;
      }

      const referencesValid = referenceNodes.every((referenceNode) => {
        const transformsNode = this.findFirstChildElement(
          referenceNode,
          (child) => getXmlLocalName(child.name) === 'Transforms',
        );
        const transforms = transformsNode
          ? this.getElementChildren(transformsNode)
              .filter((child) => getXmlLocalName(child.name) === 'Transform')
              .map((child) => child.attrs?.Algorithm)
              .filter(Boolean)
          : [];
        if (
          transforms.some(
            (transform) => !SAML_ALLOWED_REFERENCE_TRANSFORMS.has(transform),
          )
        ) {
          return false;
        }

        const referenceUri = referenceNode.attrs?.URI || '';
        if (!referenceUri.startsWith('#')) {
          return false;
        }
        const targetId = referenceUri.slice(1);
        if (!targetId || targetId !== candidateId) {
          return false;
        }

        const referencedNode = this.findElementById(responseNode, targetId);
        if (!referencedNode || referencedNode !== candidateNode) {
          return false;
        }

        const digestMethod = this.findFirstChildElement(
          referenceNode,
          (child) => getXmlLocalName(child.name) === 'DigestMethod',
        )?.attrs?.Algorithm;
        const digestAlgorithm = digestMethod
          ? SAML_ALLOWED_DIGEST_METHODS[digestMethod]
          : null;
        if (!digestAlgorithm) {
          return false;
        }
        const digestValue = this.readNodeText(
          this.findFirstChildElement(
            referenceNode,
            (child) => getXmlLocalName(child.name) === 'DigestValue',
          ),
        );
        if (!digestValue) {
          return false;
        }

        const canonicalizedReference = this.canonicalizeXmlNode(candidateNode, {
          excludeNode: signatureNode,
        });
        const computedDigest = crypto
          .createHash(digestAlgorithm)
          .update(canonicalizedReference, 'utf8')
          .digest('base64');
        return computedDigest === digestValue.replace(/\s+/g, '');
      });
      if (!referencesValid) {
        continue;
      }

      const canonicalizedSignedInfo = this.canonicalizeXmlNode(signedInfoNode);
      const signatureValue = this.readNodeText(signatureValueNode);
      if (!signatureValue) {
        continue;
      }
      const signatureBuffer = Buffer.from(
        signatureValue.replace(/\s+/g, ''),
        'base64',
      );
      const signatureValid = verificationKeys.some((verificationKey) => {
        const verifier = crypto.createVerify(verifyAlgorithm);
        verifier.update(canonicalizedSignedInfo, 'utf8');
        verifier.end();
        return verifier.verify(verificationKey, signatureBuffer);
      });
      if (!signatureValid) {
        continue;
      }

      const signedElementName = getXmlLocalName(candidateNode.name);
      if (
        signedElementName !== 'Response' &&
        signedElementName !== 'Assertion'
      ) {
        continue;
      }
      return {
        signedElementName,
        signedElementId: candidateId,
      };
    }

    throw new Error('SAML signature verification failed');
  }

  private assertSamlTimeWindow({
    notBefore,
    notOnOrAfter,
    label,
  }: {
    notBefore?: string | null;
    notOnOrAfter?: string | null;
    label: string;
  }) {
    const now = Date.now();
    const skewMs = 2 * 60 * 1000;
    if (notBefore) {
      const timestamp = new Date(notBefore).getTime();
      if (!Number.isNaN(timestamp) && timestamp - skewMs > now) {
        throw new Error(`${label} is not yet valid`);
      }
    }
    if (notOnOrAfter) {
      const timestamp = new Date(notOnOrAfter).getTime();
      if (!Number.isNaN(timestamp) && timestamp <= now - skewMs) {
        throw new Error(`${label} has expired`);
      }
    }
  }

  private buildSamlAuthnRequest({
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
  }) {
    const nameIdPolicy = nameIdFormat
      ? `<samlp:NameIDPolicy AllowCreate="true" Format="${xmlEscape(nameIdFormat)}" />`
      : '<samlp:NameIDPolicy AllowCreate="true" />';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${xmlEscape(requestId)}" Version="2.0" IssueInstant="${xmlEscape(issueInstant)}" Destination="${xmlEscape(entryPoint)}" AssertionConsumerServiceURL="${xmlEscape(redirectUri)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${xmlEscape(serviceProviderIssuer)}</saml:Issuer>${nameIdPolicy}</samlp:AuthnRequest>`;
  }

  private async resolveAuthorizationEndpoint(config: OIDCProviderConfig) {
    if (config.authorizationEndpoint) {
      return config.authorizationEndpoint;
    }
    const metadata = await this.fetchOidcMetadata(config);
    return metadata.authorization_endpoint;
  }

  private async fetchOidcMetadata(config: OIDCProviderConfig) {
    if (!config.issuer) {
      throw new Error('OIDC issuer is required');
    }
    const response = await fetch(
      `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    );
    if (!response.ok) {
      throw new Error('Failed to load OIDC metadata');
    }
    return response.json();
  }

  private async exchangeCodeForTokens({
    providerConfig,
    code,
    codeVerifier,
    redirectUri,
  }: {
    providerConfig: OIDCProviderConfig;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    const metadata =
      providerConfig.tokenEndpoint && providerConfig.userInfoEndpoint
        ? null
        : await this.fetchOidcMetadata(providerConfig);
    const tokenEndpoint =
      providerConfig.tokenEndpoint || metadata?.token_endpoint;
    if (!tokenEndpoint) {
      throw new Error('OIDC token endpoint is required');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: providerConfig.clientId || '',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    if (providerConfig.clientSecret) {
      body.set('client_secret', providerConfig.clientSecret);
    }

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload.error_description ||
          payload.error ||
          'OIDC code exchange failed',
      );
    }
    return payload;
  }

  private async loadUserClaims({
    providerConfig,
    accessToken,
    idToken,
  }: {
    providerConfig: OIDCProviderConfig;
    accessToken?: string;
    idToken?: string;
  }) {
    const metadata =
      providerConfig.userInfoEndpoint || providerConfig.authorizationEndpoint
        ? null
        : await this.fetchOidcMetadata(providerConfig);
    const userInfoEndpoint =
      providerConfig.userInfoEndpoint || metadata?.userinfo_endpoint;

    if (userInfoEndpoint && accessToken) {
      const response = await fetch(userInfoEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.ok) {
        return (await response.json()) as Record<string, any>;
      }
    }

    const decoded = decodeJwtPayload(idToken);
    if (decoded) {
      return decoded;
    }

    throw new Error('Unable to resolve OIDC user claims');
  }

  private resolveMappedRoleKey(
    groups: string[],
    mappings: Array<{ group: string; roleKey: string }>,
  ) {
    const matched = mappings
      .filter((mapping) => groups.includes(mapping.group))
      .sort(
        (left, right) =>
          (rolePriority[right.roleKey] || 0) -
          (rolePriority[left.roleKey] || 0),
      );
    return matched[0]?.roleKey || null;
  }
}
