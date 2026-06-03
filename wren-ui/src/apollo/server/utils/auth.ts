import { NextApiRequest, NextApiResponse } from 'next';

export const AUTH_COOKIE_NAME = 'wren_auth_session';

export const getCookie = (
  req: Pick<NextApiRequest, 'headers'>,
  name: string,
): string | null => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(name.length + 1));
};

export const setAuthCookie = (
  res: NextApiResponse,
  token: string,
  expiresAt: string,
) => {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(
      token,
    )}; Path=/; Expires=${new Date(
      expiresAt,
    ).toUTCString()}; HttpOnly; SameSite=Lax`,
  );
};

export const clearAuthCookie = (res: NextApiResponse) => {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
  );
};

export const sanitizeAuthSession = (session: any) => {
  if (!session) return session;
  const sanitizeUser = (user: any) => {
    if (!user) return user;
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  };
  return {
    user: sanitizeUser(session.user),
    member: session.member
      ? { ...session.member, user: sanitizeUser(session.member.user) }
      : session.member,
    organization: session.organization,
    role: session.role,
  };
};
