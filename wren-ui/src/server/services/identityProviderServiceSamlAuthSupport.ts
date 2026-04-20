import crypto from 'crypto';
import { IdentityProviderConfig } from '@server/repositories';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { XMLParser } = require('fast-xml-parser');

import {
  ensureArray,
  getXmlLocalName,
  readAttributeArray,
  readAttributeValue,
  readSamlConfig,
  SAML_ALLOWED_CANONICALIZATION_ALGORITHMS,
  SAML_ALLOWED_DIGEST_METHODS,
  SAML_ALLOWED_REFERENCE_TRANSFORMS,
  SAML_ALLOWED_SIGNATURE_METHODS,
  SAMLProviderConfig,
  SamlSignatureVerificationResult,
  SSOClaims,
  XMLElementNode,
} from './identityProviderServiceShared';
import {
  canonicalizeXmlNode,
  findElementById,
  parseXmlTree,
  samlXmlTreeSupport,
} from './identityProviderServiceSamlXmlSupport';

export const completeSamlSSO = async ({
  provider,
  ssoSession,
  samlResponse,
  origin,
}: {
  provider: IdentityProviderConfig;
  ssoSession: any;
  samlResponse?: string;
  origin: string;
}): Promise<SSOClaims> => {
  if (!samlResponse) {
    throw new Error('SAMLResponse is required');
  }

  const samlConfig = readSamlConfig(provider);
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  const responseTree = parseXmlTree(xml);
  if (getXmlLocalName(responseTree.name) !== 'Response') {
    throw new Error('Unexpected SAML payload root');
  }

  const signatureVerification =
    samlConfig.allowUnsignedResponse === true
      ? null
      : verifySamlSignature(responseTree, samlConfig);
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
    throw new Error('Signed SAML response must contain exactly one assertion');
  }

  assertSamlTimeWindow({
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
  assertSamlTimeWindow({
    notOnOrAfter: subjectConfirmationData?.NotOnOrAfter || null,
    label: 'SAML subject confirmation',
  });

  const nameIdValue =
    assertion?.Subject?.NameID?.['#text'] || assertion?.Subject?.NameID || null;
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
};

const resolveSamlVerificationKeys = (config: SAMLProviderConfig) => {
  const rawCertificates = [
    ...ensureArray(config.signingCertificates),
    config.signingCertificate,
    config.x509Certificate,
    config.certificate,
  ];
  return rawCertificates
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((certificate) => normalizeSigningCertificatePem(certificate))
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
};

const verifySamlSignature = (
  responseNode: XMLElementNode,
  config: SAMLProviderConfig,
): SamlSignatureVerificationResult => {
  const verificationKeys = resolveSamlVerificationKeys(config);
  if (verificationKeys.length === 0) {
    throw new Error(
      'SAML signing certificate/public key is required unless allowUnsignedResponse=true',
    );
  }

  const assertionNodes = samlXmlTreeSupport.findDescendantElements(
    responseNode,
    (child) => getXmlLocalName(child.name) === 'Assertion',
  );
  const candidateNodes = [...assertionNodes, responseNode].filter((candidate) =>
    Boolean(
      samlXmlTreeSupport.findFirstChildElement(
        candidate,
        (child) => getXmlLocalName(child.name) === 'Signature',
      ),
    ),
  );

  for (const candidateNode of candidateNodes) {
    const signatureNode = samlXmlTreeSupport.findFirstChildElement(
      candidateNode,
      (child) => getXmlLocalName(child.name) === 'Signature',
    );
    if (!signatureNode) {
      continue;
    }
    const signedInfoNode = samlXmlTreeSupport.findFirstChildElement(
      signatureNode,
      (child) => getXmlLocalName(child.name) === 'SignedInfo',
    );
    const signatureValueNode = samlXmlTreeSupport.findFirstChildElement(
      signatureNode,
      (child) => getXmlLocalName(child.name) === 'SignatureValue',
    );
    if (!signedInfoNode || !signatureValueNode) {
      continue;
    }

    const canonicalizationMethod = samlXmlTreeSupport.findFirstChildElement(
      signedInfoNode,
      (child) => getXmlLocalName(child.name) === 'CanonicalizationMethod',
    )?.attrs?.Algorithm;
    if (
      !canonicalizationMethod ||
      !SAML_ALLOWED_CANONICALIZATION_ALGORITHMS.has(canonicalizationMethod)
    ) {
      continue;
    }

    const signatureMethod = samlXmlTreeSupport.findFirstChildElement(
      signedInfoNode,
      (child) => getXmlLocalName(child.name) === 'SignatureMethod',
    )?.attrs?.Algorithm;
    const verifyAlgorithm = signatureMethod
      ? SAML_ALLOWED_SIGNATURE_METHODS[signatureMethod]
      : null;
    if (!verifyAlgorithm) {
      continue;
    }

    const referenceNodes = samlXmlTreeSupport
      .getElementChildren(signedInfoNode)
      .filter((child) => getXmlLocalName(child.name) === 'Reference');
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
      const transformsNode = samlXmlTreeSupport.findFirstChildElement(
        referenceNode,
        (child) => getXmlLocalName(child.name) === 'Transforms',
      );
      const transforms = transformsNode
        ? samlXmlTreeSupport
            .getElementChildren(transformsNode)
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

      const referencedNode = findElementById(responseNode, targetId);
      if (!referencedNode || referencedNode !== candidateNode) {
        return false;
      }

      const digestMethod = samlXmlTreeSupport.findFirstChildElement(
        referenceNode,
        (child) => getXmlLocalName(child.name) === 'DigestMethod',
      )?.attrs?.Algorithm;
      const digestAlgorithm = digestMethod
        ? SAML_ALLOWED_DIGEST_METHODS[digestMethod]
        : null;
      if (!digestAlgorithm) {
        return false;
      }
      const digestValue = samlXmlTreeSupport.readNodeText(
        samlXmlTreeSupport.findFirstChildElement(
          referenceNode,
          (child) => getXmlLocalName(child.name) === 'DigestValue',
        ),
      );
      if (!digestValue) {
        return false;
      }

      const canonicalizedReference = canonicalizeXmlNode(candidateNode, {
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

    const canonicalizedSignedInfo = canonicalizeXmlNode(signedInfoNode);
    const signatureValue = samlXmlTreeSupport.readNodeText(signatureValueNode);
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
    if (signedElementName !== 'Response' && signedElementName !== 'Assertion') {
      continue;
    }
    return {
      signedElementName,
      signedElementId: candidateId,
    };
  }

  throw new Error('SAML signature verification failed');
};

const assertSamlTimeWindow = ({
  notBefore,
  notOnOrAfter,
  label,
}: {
  notBefore?: string | null;
  notOnOrAfter?: string | null;
  label: string;
}) => {
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
};

const normalizeSigningCertificatePem = (certificate: string) => {
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
