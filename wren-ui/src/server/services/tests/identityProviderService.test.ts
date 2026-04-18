import crypto from 'crypto';
import { IdentityProviderService } from '../identityProviderService';

const TEST_X509_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUVNKoGrKNjlpVgwL9CqvGpCnlam0wDQYJKoZIhvcNAQEL
BQAwNDEUMBIGA1UEAwwLd3JlbmFpLXRlc3QxDzANBgNVBAoMBldyZW5BSTELMAkG
A1UEBhMCVVMwHhcNMjYwNDE0MDQzNjE4WhcNMzYwNDExMDQzNjE4WjA0MRQwEgYD
VQQDDAt3cmVuYWktdGVzdDEPMA0GA1UECgwGV3JlbkFJMQswCQYDVQQGEwJVUzCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALfqLhfPo77qprh8EOEx+EOL
4NAPgaSG1kpiNpfCTOlKmfiEBv5qFPhEdJlgqNGsBKaxzE+E95OnSyOuI/M6K42N
a6UlmRtDW9W5+t5m9W1dE3ECA1m2OYkGmPRJFtAW8jak453PK+A3jH5Rdfc2QlIi
qIKeSKK7QW/fLE/Eqhi6WtrUY+G6nNTisdKkF0Mh9maGi0M2cs4LLACkYoFRIgt5
VaBTIf+6BNLAfkJFC9Wmql6l9axQBuKF5804iMAC1AJYoo4c/JB3M7GJU72aRc1Q
DdUu+aHh3BeaEewTsbDymR4HSgAlw636LseeWA7WEL2PpKo3UoSHjiezyk669CkC
AwEAAaNTMFEwHQYDVR0OBBYEFIWzsR+YKiP8sS5FQ20GzxTYo4ONMB8GA1UdIwQY
MBaAFIWzsR+YKiP8sS5FQ20GzxTYo4ONMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAGSeoTHvFV6SO1Js0b7BCVLGFvVNudQE2iB05idyhqLISGQw
P3c4vIVb2pUAYg2s/hQYlqsOkxCCW+2abCsqqtZYaGjyhuRsWksAwh1wUgau/gt3
UivSt643S1jfal2OeKB54DyRSv11+0xucKxbMC9TdXDkV3InPK1CgFOJ7Zbj1zV1
59HFDLYTnye8MmXYOfvmbG8kQ9pUTBegMM3SCbYcEapmGi6dpwZemijuYyZAEe7D
zwz4fxjEjH2p0Dvg72T189JmKHwNkvWlLMhR7d5g5oRL6RcBbE54EdMgwN6XZil9
P8qVhdDky7tRibAs+IWjqyJQY6MTkMvUYpkkaxs=
-----END CERTIFICATE-----`;

describe('IdentityProviderService', () => {
  const createService = (overrides?: {
    identityProviderConfigRepository?: Record<string, any>;
    ssoSessionRepository?: Record<string, any>;
    workspaceRepository?: Record<string, any>;
  }) => {
    const workspaceRepository = {
      findOneBy: jest.fn(),
      ...(overrides?.workspaceRepository || {}),
    };
    const userRepository = {
      transaction: jest.fn(),
    };
    const authIdentityRepository = {};
    const identityProviderConfigRepository = {
      createOne: jest.fn(),
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
      ...(overrides?.identityProviderConfigRepository || {}),
    };
    const ssoSessionRepository = {
      findOneBy: jest.fn(),
      ...(overrides?.ssoSessionRepository || {}),
    };
    const workspaceService = {};
    const authService = {};

    return {
      workspaceRepository,
      identityProviderConfigRepository,
      service: new IdentityProviderService(
        workspaceRepository as any,
        userRepository as any,
        authIdentityRepository as any,
        identityProviderConfigRepository as any,
        ssoSessionRepository as any,
        workspaceService as any,
        authService as any,
      ),
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  it('preserves the stored clientSecret when UI submits the masked placeholder', async () => {
    const existingProvider = {
      id: 'idp-1',
      workspaceId: 'workspace-1',
      providerType: 'oidc',
      name: 'Enterprise OIDC',
      enabled: true,
      configJson: {
        issuer: 'https://issuer.example.com',
        clientId: 'client-id',
        clientSecret: 'secret-old',
      },
    };

    const { service, identityProviderConfigRepository } = createService({
      identityProviderConfigRepository: {
        findOneBy: jest.fn().mockResolvedValue(existingProvider),
        updateOne: jest
          .fn()
          .mockImplementation(async (_id: string, payload: any) => ({
            ...existingProvider,
            ...payload,
          })),
      },
    });

    const updated = await service.updateProvider({
      workspaceId: 'workspace-1',
      id: 'idp-1',
      configJson: {
        clientSecret: '••••••••',
      },
    });

    expect(identityProviderConfigRepository.updateOne).toHaveBeenCalledWith(
      'idp-1',
      expect.objectContaining({
        configJson: expect.objectContaining({
          clientSecret: 'secret-old',
        }),
      }),
    );
    expect(updated.configJson?.clientSecret).toBe('••••••••');
    expect(updated.configJson?.hasClientSecret).toBe(true);
  });

  it('allows explicitly clearing clientSecret', async () => {
    const existingProvider = {
      id: 'idp-1',
      workspaceId: 'workspace-1',
      providerType: 'oidc',
      name: 'Enterprise OIDC',
      enabled: true,
      configJson: {
        issuer: 'https://issuer.example.com',
        clientId: 'client-id',
        clientSecret: 'secret-old',
      },
    };

    const { service, identityProviderConfigRepository } = createService({
      identityProviderConfigRepository: {
        findOneBy: jest.fn().mockResolvedValue(existingProvider),
        updateOne: jest
          .fn()
          .mockImplementation(async (_id: string, payload: any) => ({
            ...existingProvider,
            ...payload,
          })),
      },
    });

    await service.updateProvider({
      workspaceId: 'workspace-1',
      id: 'idp-1',
      configJson: {
        clientSecret: '',
      },
    });

    expect(identityProviderConfigRepository.updateOne).toHaveBeenCalledWith(
      'idp-1',
      expect.objectContaining({
        configJson: expect.objectContaining({
          clientSecret: null,
        }),
      }),
    );
  });

  it('extracts SAML metadata and keeps rotated signing certificates', async () => {
    const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>AAAABBBB</X509Certificate>
          <X509Certificate>CCCCDDDD</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso/redirect" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const workspace = { id: 'workspace-1', name: 'Demo Workspace' };
    const { service, workspaceRepository, identityProviderConfigRepository } =
      createService({
        workspaceRepository: {
          findOneBy: jest.fn().mockResolvedValue(workspace),
        },
        identityProviderConfigRepository: {
          createOne: jest
            .fn()
            .mockImplementation(async (payload: any) => payload),
        },
      });

    const provider = await service.createProvider({
      workspaceId: 'workspace-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        metadataXml,
        allowUnsignedResponse: false,
      },
      createdBy: 'user-1',
    });

    expect(workspaceRepository.findOneBy).toHaveBeenCalledWith({
      id: 'workspace-1',
    });
    expect(identityProviderConfigRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        configJson: expect.objectContaining({
          issuer: 'https://idp.example.com/metadata',
          entryPoint: 'https://idp.example.com/sso/redirect',
          signingCertificates: ['AAAABBBB', 'CCCCDDDD'],
          signingCertificate: 'AAAABBBB',
          metadataXml,
        }),
      }),
    );
    expect(provider.configJson?.signingCertificates).toEqual([
      'AAAABBBB',
      'CCCCDDDD',
    ]);
  });

  it('fetches SAML metadata from metadataUrl and stores refresh info', async () => {
    const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>AAAABBBB</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso/redirect" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const workspace = { id: 'workspace-1', name: 'Demo Workspace' };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(metadataXml),
    });
    (global as any).fetch = fetchMock;
    const { service, workspaceRepository, identityProviderConfigRepository } =
      createService({
        workspaceRepository: {
          findOneBy: jest.fn().mockResolvedValue(workspace),
        },
        identityProviderConfigRepository: {
          createOne: jest
            .fn()
            .mockImplementation(async (payload: any) => payload),
        },
      });

    const provider = await service.createProvider({
      workspaceId: 'workspace-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        metadataUrl: 'https://idp.example.com/metadata.xml',
        allowUnsignedResponse: false,
      },
      createdBy: 'user-1',
    });

    expect(workspaceRepository.findOneBy).toHaveBeenCalledWith({
      id: 'workspace-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.example.com/metadata.xml',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(identityProviderConfigRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        configJson: expect.objectContaining({
          metadataUrl: 'https://idp.example.com/metadata.xml',
          metadataXml,
          metadataFetchedAt: expect.any(String),
          issuer: 'https://idp.example.com/metadata',
          entryPoint: 'https://idp.example.com/sso/redirect',
        }),
      }),
    );
    expect(provider.configJson?.metadataUrl).toBe(
      'https://idp.example.com/metadata.xml',
    );
    expect(provider.configJson?.metadataSource).toBe('url');
    expect(provider.configJson?.metadataFetchedAt).toEqual(expect.any(String));
  });

  it('fails when metadataUrl returns a non-200 response', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('temporarily unavailable'),
    });
    const workspace = { id: 'workspace-1', name: 'Demo Workspace' };
    const { service } = createService({
      workspaceRepository: {
        findOneBy: jest.fn().mockResolvedValue(workspace),
      },
    });

    await expect(
      service.createProvider({
        workspaceId: 'workspace-1',
        providerType: 'saml',
        name: 'Enterprise SAML',
        enabled: true,
        configJson: {
          metadataUrl: 'https://idp.example.com/metadata.xml',
        },
        createdBy: 'user-1',
      }),
    ).rejects.toThrow('Failed to fetch SAML metadata URL: HTTP 503');
  });

  it('fails when metadataUrl cannot be fetched', async () => {
    (global as any).fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down'));
    const workspace = { id: 'workspace-1', name: 'Demo Workspace' };
    const { service } = createService({
      workspaceRepository: {
        findOneBy: jest.fn().mockResolvedValue(workspace),
      },
    });

    await expect(
      service.createProvider({
        workspaceId: 'workspace-1',
        providerType: 'saml',
        name: 'Enterprise SAML',
        enabled: true,
        configJson: {
          metadataUrl: 'https://idp.example.com/metadata.xml',
        },
        createdBy: 'user-1',
      }),
    ).rejects.toThrow('Failed to fetch SAML metadata URL: network down');
  });

  it('auto-refreshes stale metadataUrl providers before use', async () => {
    const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>AAAABBBB</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso/redirect" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const staleProvider = {
      id: 'idp-1',
      workspaceId: 'workspace-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        metadataUrl: 'https://idp.example.com/metadata.xml',
        metadataFetchedAt: '2000-01-01T00:00:00.000Z',
        metadataXml: '<old />',
        entryPoint: 'https://old.example.com/sso',
      },
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(metadataXml),
    });
    (global as any).fetch = fetchMock;
    const { service, identityProviderConfigRepository } = createService({
      identityProviderConfigRepository: {
        updateOne: jest
          .fn()
          .mockImplementation(async (_id: string, payload: any) => ({
            ...staleProvider,
            ...payload,
            configJson: {
              ...(staleProvider.configJson || {}),
              ...(payload.configJson || {}),
            },
          })),
      },
    });

    const refreshed = await (service as any).maybeRefreshSamlMetadataProvider(
      staleProvider,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.example.com/metadata.xml',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(identityProviderConfigRepository.updateOne).toHaveBeenCalledWith(
      'idp-1',
      expect.objectContaining({
        configJson: expect.objectContaining({
          metadataXml,
          issuer: 'https://idp.example.com/metadata',
          entryPoint: 'https://idp.example.com/sso/redirect',
          metadataFetchedAt: expect.any(String),
        }),
      }),
    );
    expect(refreshed.configJson.entryPoint).toBe(
      'https://idp.example.com/sso/redirect',
    );
  });

  it('keeps cached SAML metadata when auto-refresh fails', async () => {
    const staleProvider = {
      id: 'idp-1',
      workspaceId: 'workspace-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        metadataUrl: 'https://idp.example.com/metadata.xml',
        metadataFetchedAt: '2000-01-01T00:00:00.000Z',
        metadataXml: '<cached />',
        entryPoint: 'https://cached.example.com/sso',
      },
    };
    (global as any).fetch = jest
      .fn()
      .mockRejectedValue(new Error('temporary outage'));
    const { service, identityProviderConfigRepository } = createService({
      identityProviderConfigRepository: {
        updateOne: jest.fn(),
      },
    });

    const refreshed = await (service as any).maybeRefreshSamlMetadataProvider(
      staleProvider,
    );

    expect(identityProviderConfigRepository.updateOne).not.toHaveBeenCalled();
    expect(refreshed).toBe(staleProvider);
  });

  it('exposes SAML certificate summaries in the public provider view', async () => {
    const workspace = { id: 'workspace-1', name: 'Demo Workspace' };
    const { service } = createService({
      workspaceRepository: {
        findOneBy: jest.fn().mockResolvedValue(workspace),
      },
      identityProviderConfigRepository: {
        createOne: jest
          .fn()
          .mockImplementation(async (payload: any) => payload),
      },
    });

    const provider = await service.createProvider({
      workspaceId: 'workspace-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        entryPoint: 'https://idp.example.com/sso',
        signingCertificate: TEST_X509_CERTIFICATE,
      },
      createdBy: 'user-1',
    });

    expect(provider.configJson?.signingCertificateCount).toBe(1);
    expect(provider.configJson?.signingCertificateSummaries).toEqual([
      expect.objectContaining({
        subject: expect.stringContaining('CN=wrenai-test'),
        issuer: expect.stringContaining('CN=wrenai-test'),
        validTo: expect.any(String),
        fingerprint256: expect.any(String),
        source: 'certificate',
      }),
    ]);
    expect(provider.configJson?.earliestCertificateExpiryAt).toEqual(
      provider.configJson?.signingCertificateSummaries?.[0]?.validTo,
    );
  });

  it('verifies signed SAML assertions with configured public key', async () => {
    const { publicKey: stalePublicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const stalePublicKeyPem = stalePublicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    const publicKeyPem = publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    const { service } = createService();
    const samlService = service as any;

    const requestId = '_request-123';
    const destination = 'http://localhost:3000/api/auth/sso/callback';
    const issueInstant = '2026-04-14T00:00:00.000Z';
    const unsignedResponse = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_response-1" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}" InResponseTo="${requestId}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.example.com</saml:Issuer>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-1" Version="2.0" IssueInstant="${issueInstant}">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject>
      <saml:NameID>user@example.com</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${destination}" NotOnOrAfter="2099-04-14T00:05:00.000Z"></saml:SubjectConfirmationData>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-04-13T23:59:00.000Z" NotOnOrAfter="2099-04-14T00:05:00.000Z">
      <saml:AudienceRestriction>
        <saml:Audience>wrenai-tests</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="email">
        <saml:AttributeValue>user@example.com</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="displayName">
        <saml:AttributeValue>Test User</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>finance-admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;
    const responseTree = samlService.parseXmlTree(unsignedResponse);
    const assertionNode = samlService.findElementById(
      responseTree,
      '_assertion-1',
    );
    const canonicalizedAssertion =
      samlService.canonicalizeXmlNode(assertionNode);
    const digestValue = crypto
      .createHash('sha256')
      .update(canonicalizedAssertion, 'utf8')
      .digest('base64');
    const signedInfoXml = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod><ds:Reference URI="#_assertion-1"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${digestValue}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
    const signedInfoTree = samlService.parseXmlTree(signedInfoXml);
    const canonicalizedSignedInfo =
      samlService.canonicalizeXmlNode(signedInfoTree);
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalizedSignedInfo, 'utf8');
    signer.end();
    const signatureValue = signer.sign(privateKey).toString('base64');
    const signatureXml = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<ds:SignatureValue>${signatureValue}</ds:SignatureValue></ds:Signature>`;
    const signedResponse = unsignedResponse.replace(
      '<saml:Issuer>https://idp.example.com</saml:Issuer>',
      `<saml:Issuer>https://idp.example.com</saml:Issuer>${signatureXml}`,
    );

    const claims = await samlService.completeSamlSSO({
      provider: {
        id: 'idp-1',
        workspaceId: 'workspace-1',
        providerType: 'saml',
        name: 'Enterprise SAML',
        enabled: true,
        configJson: {
          issuer: 'https://idp.example.com',
          entryPoint: 'https://idp.example.com/sso',
          audience: 'wrenai-tests',
          signingCertificates: [stalePublicKeyPem, publicKeyPem],
        },
      },
      ssoSession: {
        id: 'sso-session-1',
        providerRequestId: requestId,
      },
      samlResponse: Buffer.from(signedResponse, 'utf8').toString('base64'),
      origin: 'http://localhost:3000',
    });

    expect(claims).toEqual({
      externalSubject: 'user@example.com',
      email: 'user@example.com',
      displayName: 'Test User',
      groups: ['finance-admins'],
      issuer: 'https://idp.example.com',
    });
  });

  it('rejects unsigned SAML responses when allowUnsignedResponse is disabled', async () => {
    const { service } = createService();
    const samlService = service as any;
    const samlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_response-2" Version="2.0" IssueInstant="2026-04-14T00:00:00.000Z" Destination="http://localhost:3000/api/auth/sso/callback">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.example.com</saml:Issuer>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-2" Version="2.0" IssueInstant="2026-04-14T00:00:00.000Z">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject><saml:NameID>user@example.com</saml:NameID></saml:Subject>
    <saml:Conditions NotOnOrAfter="2099-04-14T00:05:00.000Z"></saml:Conditions>
  </saml:Assertion>
</samlp:Response>`;

    await expect(
      samlService.completeSamlSSO({
        provider: {
          id: 'idp-1',
          workspaceId: 'workspace-1',
          providerType: 'saml',
          name: 'Enterprise SAML',
          enabled: true,
          configJson: {
            issuer: 'https://idp.example.com',
            entryPoint: 'https://idp.example.com/sso',
          },
        },
        ssoSession: {
          id: 'sso-session-1',
          providerRequestId: '_request-456',
        },
        samlResponse: Buffer.from(samlResponse, 'utf8').toString('base64'),
        origin: 'http://localhost:3000',
      }),
    ).rejects.toThrow(
      'SAML signing certificate/public key is required unless allowUnsignedResponse=true',
    );
  });

  it('keeps compatibility with allowUnsignedResponse=true', async () => {
    const { service } = createService();
    const samlService = service as any;
    const requestId = '_request-789';
    const samlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_response-3" Version="2.0" IssueInstant="2026-04-14T00:00:00.000Z" Destination="http://localhost:3000/api/auth/sso/callback" InResponseTo="${requestId}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.example.com</saml:Issuer>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-3" Version="2.0" IssueInstant="2026-04-14T00:00:00.000Z">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject>
      <saml:NameID>user@example.com</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="http://localhost:3000/api/auth/sso/callback" NotOnOrAfter="2099-04-14T00:05:00.000Z"></saml:SubjectConfirmationData>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-04-13T23:59:00.000Z" NotOnOrAfter="2099-04-14T00:05:00.000Z">
      <saml:AudienceRestriction>
        <saml:Audience>wrenai-tests</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
  </saml:Assertion>
</samlp:Response>`;

    const claims = await samlService.completeSamlSSO({
      provider: {
        id: 'idp-1',
        workspaceId: 'workspace-1',
        providerType: 'saml',
        name: 'Enterprise SAML',
        enabled: true,
        configJson: {
          issuer: 'https://idp.example.com',
          entryPoint: 'https://idp.example.com/sso',
          audience: 'wrenai-tests',
          allowUnsignedResponse: true,
        },
      },
      ssoSession: {
        id: 'sso-session-1',
        providerRequestId: requestId,
      },
      samlResponse: Buffer.from(samlResponse, 'utf8').toString('base64'),
      origin: 'http://localhost:3000',
    });

    expect(claims.externalSubject).toBe('user@example.com');
  });
});
