import type { NextApiRequest } from 'next';

const SESSION_COOKIE_NAME = 'wren_session';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

const isLoopbackHost = (hostHeader?: string | string[]) => {
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const normalizedHost = host?.toLowerCase().trim();

  if (!normalizedHost) {
    return false;
  }

  return (
    normalizedHost.startsWith('127.0.0.1') ||
    normalizedHost.startsWith('localhost') ||
    normalizedHost.startsWith('[::1]') ||
    normalizedHost.startsWith('::1')
  );
};

const isSecureRequest = (req?: NextApiRequest) => {
  if (isLoopbackHost(req?.headers.host)) {
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  const forwardedProto = req?.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return proto === 'https';
};

export const buildSessionCookie = (
  sessionToken: string,
  req?: NextApiRequest,
) => {
  const secureFlag = isSecureRequest(req) ? '; Secure' : '';

  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_WEEK_SECONDS}${secureFlag}`;
};

export const clearSessionCookie = (req?: NextApiRequest) => {
  const secureFlag = isSecureRequest(req) ? '; Secure' : '';

  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
};
