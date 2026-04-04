import type { NextApiRequest } from 'next';

const SESSION_COOKIE_NAME = 'wren_session';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

const isSecureRequest = (req?: NextApiRequest) => {
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
