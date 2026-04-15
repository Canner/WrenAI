import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const getOrigin = (req: NextApiRequest) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || 'http';
  const host = req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
};

const getRequestIpAddress = (req: NextApiRequest) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;
  return (
    forwardedValue?.split(',')[0]?.trim() || req.socket.remoteAddress || null
  );
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const workspaceSlug =
      getString(
        req.method === 'GET'
          ? req.query.workspaceSlug
          : req.body?.workspaceSlug,
      ) || getString(req.query.slug);
    if (!workspaceSlug) {
      return res.status(400).json({ error: 'workspaceSlug is required' });
    }

    const result = await components.identityProviderService.startWorkspaceSSO({
      workspaceSlug,
      origin: getOrigin(req),
      redirectTo:
        getString(
          req.method === 'GET' ? req.query.redirectTo : req.body?.redirectTo,
        ) || null,
      ipAddress: getRequestIpAddress(req),
      userAgent:
        (Array.isArray(req.headers['user-agent'])
          ? req.headers['user-agent'][0]
          : req.headers['user-agent']) || null,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || 'Failed to start enterprise SSO',
    });
  }
}
