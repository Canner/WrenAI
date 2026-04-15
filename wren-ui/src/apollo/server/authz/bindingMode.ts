const normalizeBindingMode = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

export type AuthorizationBindingMode = 'dual_read' | 'binding_only';

export const getAuthorizationBindingMode = (): AuthorizationBindingMode =>
  normalizeBindingMode(
    process.env.WREN_AUTHORIZATION_BINDING_MODE ||
      process.env.AUTHORIZATION_BINDING_MODE,
  ) === 'binding_only'
    ? 'binding_only'
    : 'dual_read';

export const isAuthorizationBindingOnlyEnabled = () =>
  getAuthorizationBindingMode() === 'binding_only';
