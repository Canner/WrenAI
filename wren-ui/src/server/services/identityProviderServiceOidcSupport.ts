import { IdentityProviderConfig } from '@server/repositories';
import {
  decodeJwtPayload,
  getClaimStringArray,
  getClaimValue,
  OIDCProviderConfig,
  readOidcConfig,
  SSOClaims,
} from './identityProviderServiceShared';

export const completeOidcSSO = async ({
  provider,
  ssoSession,
  code,
  origin,
}: {
  provider: IdentityProviderConfig;
  ssoSession: any;
  code?: string;
  origin: string;
}): Promise<SSOClaims> => {
  if (!code) {
    throw new Error('OIDC code is required');
  }

  const oidcConfig = readOidcConfig(provider);
  const redirectUri = `${origin}/api/auth/sso/callback`;
  const tokenResponse = await exchangeCodeForTokens({
    providerConfig: oidcConfig,
    code,
    codeVerifier: ssoSession.codeVerifier,
    redirectUri,
  });

  const claims = await loadUserClaims({
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
};

export const resolveAuthorizationEndpoint = async (
  config: OIDCProviderConfig,
) => {
  if (config.authorizationEndpoint) {
    return config.authorizationEndpoint;
  }
  const metadata = await fetchOidcMetadata(config);
  return metadata.authorization_endpoint;
};

export const fetchOidcMetadata = async (config: OIDCProviderConfig) => {
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
};

export const exchangeCodeForTokens = async ({
  providerConfig,
  code,
  codeVerifier,
  redirectUri,
}: {
  providerConfig: OIDCProviderConfig;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) => {
  const metadata =
    providerConfig.tokenEndpoint && providerConfig.userInfoEndpoint
      ? null
      : await fetchOidcMetadata(providerConfig);
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
      payload.error_description || payload.error || 'OIDC code exchange failed',
    );
  }
  return payload;
};

export const loadUserClaims = async ({
  providerConfig,
  accessToken,
  idToken,
}: {
  providerConfig: OIDCProviderConfig;
  accessToken?: string;
  idToken?: string;
}) => {
  const metadata =
    providerConfig.userInfoEndpoint || providerConfig.authorizationEndpoint
      ? null
      : await fetchOidcMetadata(providerConfig);
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
};
