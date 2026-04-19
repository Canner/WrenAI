import {
  getCertificateExpiryStatus,
  getIdentityProviderMetadataState,
  hasIdentityProviderScim,
} from './identityHealth';

describe('identityHealth helpers', () => {
  it('classifies expired and expiring saml certificates', () => {
    expect(
      getCertificateExpiryStatus(
        {
          signingCertificateSummaries: [{ status: 'expired' }],
        },
        Date.parse('2026-04-14T00:00:00.000Z'),
      ),
    ).toEqual({
      level: 'expired',
      label: '证书已过期',
      color: 'red',
    });

    expect(
      getCertificateExpiryStatus(
        {
          earliestCertificateExpiryAt: '2026-04-20T00:00:00.000Z',
        },
        Date.parse('2026-04-14T00:00:00.000Z'),
      ),
    ).toEqual({
      level: 'expiring_soon',
      label: '30 天内到期',
      color: 'orange',
    });
  });

  it('classifies healthy certificates and metadata/scim state', () => {
    expect(
      getCertificateExpiryStatus(
        {
          earliestCertificateExpiryAt: '2026-06-20T00:00:00.000Z',
        },
        Date.parse('2026-04-14T00:00:00.000Z'),
      ),
    ).toEqual({
      level: 'valid',
      label: '证书健康',
      color: 'green',
    });

    expect(
      getIdentityProviderMetadataState({
        metadataUrl: 'https://idp.example.com/metadata.xml',
        metadataFetchedAt: '2026-04-14T00:00:00.000Z',
      }),
    ).toEqual({
      source: 'url',
      label: 'Metadata URL',
      fetchedAt: '2026-04-14T00:00:00.000Z',
    });

    expect(
      getIdentityProviderMetadataState({
        metadataXml: '<xml />',
      }),
    ).toEqual({
      source: 'xml',
      label: '内嵌 XML',
      fetchedAt: null,
    });

    expect(hasIdentityProviderScim({ hasScimBearerToken: true })).toBe(true);
    expect(hasIdentityProviderScim({})).toBe(false);
  });
});
