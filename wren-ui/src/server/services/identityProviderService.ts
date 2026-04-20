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
import {
  base64UrlEncode,
  CreateIdentityProviderInput,
  IIdentityProviderService,
  IdentityProviderPublicView,
  mergeConfigJson,
  OIDCProviderConfig,
  readOidcConfig,
  readSamlConfig,
  SAMLProviderConfig,
  SamlCertificateSummary,
  SSOClaims,
  StartWorkspaceSSOResult,
  stripDerivedProviderConfigFields,
  UpdateIdentityProviderInput,
  XMLElementNode,
  sha256Base64Url,
} from './identityProviderServiceShared';
import {
  buildSamlAuthnRequest,
  buildSamlCertificateSummaries,
  findEarliestCertificateExpiry,
  maybeRefreshSamlMetadataProvider,
  normalizeSamlConfigJson,
} from './identityProviderServiceSamlMetadataSupport';
import {
  canonicalizeXmlNode,
  findElementById,
  parseXmlTree,
} from './identityProviderServiceSamlXmlSupport';
import { completeSamlSSO } from './identityProviderServiceSamlAuthSupport';
import {
  completeOidcSSO,
  resolveAuthorizationEndpoint,
} from './identityProviderServiceOidcSupport';
import { completeProvisionedIdentity } from './identityProviderServiceProvisioningSupport';

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

  public async listProviders(
    workspaceId: string,
  ): Promise<IdentityProviderPublicView[]> {
    const providers = await this.identityProviderConfigRepository.findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    );
    return providers.map((provider) => this.toPublicProvider(provider));
  }

  public async createProvider(
    input: CreateIdentityProviderInput,
  ): Promise<IdentityProviderPublicView> {
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

  public async updateProvider(
    input: UpdateIdentityProviderInput,
  ): Promise<IdentityProviderPublicView> {
    const existing = await this.requireProvider(input.workspaceId, input.id);
    const nextConfigJson = await this.normalizeProviderConfigJson(
      existing.providerType,
      mergeConfigJson(existing, input.configJson),
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

  public async deleteProvider(workspaceId: string, id: string): Promise<void> {
    await this.requireProvider(workspaceId, id);
    await this.identityProviderConfigRepository.deleteOne(id);
  }

  public async startWorkspaceSSO(input: {
    workspaceSlug: string;
    origin: string;
    redirectTo?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<StartWorkspaceSSOResult> {
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
      const providerConfig = readOidcConfig(provider);
      const authorizationEndpoint =
        await resolveAuthorizationEndpoint(providerConfig);
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

    const providerConfig = readSamlConfig(provider);
    const requestId = `_${crypto.randomBytes(20).toString('hex')}`;
    const samlRequest = buildSamlAuthnRequest({
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
  }): Promise<AuthResult> {
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

    return this.completeProvisionedIdentity({
      ssoSession,
      provider,
      claims,
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
        buildSamlCertificateSummaries(samlConfig);
      configJson.signingCertificateSummaries = signingCertificateSummaries;
      configJson.signingCertificateCount = signingCertificateSummaries.length;
      configJson.earliestCertificateExpiryAt = findEarliestCertificateExpiry(
        signingCertificateSummaries,
      );
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

    return { ...provider, configJson };
  }

  private async normalizeProviderConfigJson(
    providerType: string,
    configJson?: Record<string, any> | null,
  ) {
    if (!configJson) {
      return null;
    }
    const sanitizedConfigJson = stripDerivedProviderConfigFields(configJson);
    if (providerType !== 'saml') {
      return sanitizedConfigJson;
    }
    return normalizeSamlConfigJson(sanitizedConfigJson);
  }

  private async completeOidcSSO(args: {
    provider: IdentityProviderConfig;
    ssoSession: any;
    code?: string;
    origin: string;
  }): Promise<SSOClaims> {
    return completeOidcSSO(args);
  }

  private async completeSamlSSO(args: {
    provider: IdentityProviderConfig;
    ssoSession: any;
    samlResponse?: string;
    origin: string;
  }): Promise<SSOClaims> {
    return completeSamlSSO(args);
  }

  private async maybeRefreshSamlMetadataProvider(
    provider: IdentityProviderConfig,
    options?: { force?: boolean; softFail?: boolean },
  ) {
    return maybeRefreshSamlMetadataProvider({
      provider,
      identityProviderConfigRepository: this.identityProviderConfigRepository,
      options,
    });
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
    return completeProvisionedIdentity({
      ssoSession,
      provider,
      claims,
      userRepository: this.userRepository,
      authIdentityRepository: this.authIdentityRepository,
      workspaceService: this.workspaceService,
      authService: this.authService,
      ssoSessionRepository: this.ssoSessionRepository,
    } as any);
  }

  private parseXmlTree(xml: string): XMLElementNode {
    return parseXmlTree(xml);
  }

  private findElementById(
    node: XMLElementNode,
    id: string,
  ): XMLElementNode | null {
    return findElementById(node, id);
  }

  private canonicalizeXmlNode(
    node: XMLElementNode,
    options?: {
      excludeNode?: XMLElementNode | null;
      renderedNamespaces?: Record<string, string>;
    },
  ): string {
    return canonicalizeXmlNode(node, options);
  }
}

export type {
  AuthIdentity,
  AuthResult,
  OIDCProviderConfig,
  SAMLProviderConfig,
  SamlCertificateSummary,
};
