import { IdentityProviderConfig } from '@server/repositories';
import { ProviderConfigJson } from './scimServiceTypes';

export const getPrimaryEmail = (payload: Record<string, any>) => {
  const emails = Array.isArray(payload.emails) ? payload.emails : [];
  const primary =
    emails.find((item) => item?.primary && typeof item.value === 'string') ||
    emails.find((item) => typeof item?.value === 'string');
  if (primary?.value) {
    return String(primary.value).trim().toLowerCase();
  }
  if (typeof payload.email === 'string') {
    return payload.email.trim().toLowerCase();
  }
  return null;
};

export const getDisplayName = (payload: Record<string, any>) => {
  if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
    return payload.displayName.trim();
  }
  if (payload.name && typeof payload.name === 'object') {
    const given =
      typeof payload.name.givenName === 'string'
        ? payload.name.givenName.trim()
        : '';
    const family =
      typeof payload.name.familyName === 'string'
        ? payload.name.familyName.trim()
        : '';
    const full = `${given} ${family}`.trim();
    if (full) {
      return full;
    }
  }
  if (typeof payload.userName === 'string' && payload.userName.trim()) {
    return payload.userName.trim();
  }
  return 'SCIM User';
};

export const normalizeGroupMappings = (provider: IdentityProviderConfig) => {
  const config = (provider.configJson || {}) as ProviderConfigJson;
  const mappings = Array.isArray(config.groupRoleMappings)
    ? config.groupRoleMappings
    : [];
  return mappings
    .filter((item) => item?.group && item?.roleKey)
    .map((item) => ({
      group: String(item.group).trim(),
      roleKey: String(item.roleKey).trim().toLowerCase(),
    }));
};

export const buildScimProviderSubject = (
  providerId: string,
  externalSubject: string,
) => `scim:${providerId}:${externalSubject}`;

export const getStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item?.value || item || '').trim())
        .filter(Boolean)
    : [];
