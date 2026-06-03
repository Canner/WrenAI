import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { sanitizeAuthSession, setAuthCookie } from '@/apollo/server/utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const session = await components.rbacService.bootstrapAdmin(req.body);
    setAuthCookie(res, session.session.token, session.session.expiresAt);
    return res.status(200).json(sanitizeAuthSession(session));
  } catch (error) {
    return res.status(400).json({ message: (error as Error).message });
  }
}
