import type { NextApiRequest, NextApiResponse } from 'next';

const coerceHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || null : value || null;

export const getBearerToken = (req: NextApiRequest) => {
  const header = coerceHeader(req.headers.authorization);
  if (!header?.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim() || null;
};

export const getWorkspaceSlug = (req: NextApiRequest) => {
  const value = req.query.workspaceSlug;
  return Array.isArray(value) ? value[0] : value;
};

export const scimListResponse = (resources: any[]) => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: resources.length,
  startIndex: 1,
  itemsPerPage: resources.length,
  Resources: resources,
});

export const scimError = (
  res: NextApiResponse,
  status: number,
  detail: string,
) =>
  res.status(status).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
  });
