import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  ApiType,
  type ApiHistory,
} from '@server/repositories/apiHistoryRepository';
import { recordAuditEvent } from '@server/authz';
import {
  createHttpError,
  getQueryString,
  requirePlatformActionContext,
} from '@server/api/platform/platformApiUtils';

const parseRequiredPositiveInt = (
  value: string | undefined,
  fieldName: string,
  fallback: number,
) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${fieldName} must be a non-negative integer`);
  }

  return parsed;
};

const parseOptionalStatusCode = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw createHttpError(400, 'statusCode must be a number');
  }

  return parsed;
};

const parseOptionalApiType = (value?: string) => {
  if (!value) {
    return undefined;
  }

  if (!Object.values(ApiType).includes(value as ApiType)) {
    throw createHttpError(400, 'apiType is invalid');
  }

  return value as ApiType;
};

const normalizeDateInput = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `Invalid date value: ${value}`);
  }

  return parsed;
};

const sanitizeResponsePayload = (payload: any, apiType?: ApiType): any => {
  if (!payload) {
    return payload;
  }

  const sanitized = { ...payload };

  if (apiType === ApiType.RUN_SQL) {
    if (sanitized.records && Array.isArray(sanitized.records)) {
      sanitized.records = [`${sanitized.records.length} records omitted`];
    }
  }

  if (apiType === ApiType.GENERATE_VEGA_CHART) {
    if (
      sanitized.vegaSpec?.data?.values &&
      Array.isArray(sanitized.vegaSpec.data.values)
    ) {
      sanitized.vegaSpec = {
        ...sanitized.vegaSpec,
        data: {
          ...sanitized.vegaSpec.data,
          values: [
            `${sanitized.vegaSpec.data.values.length} data points omitted`,
          ],
        },
      };
    }
  }

  return sanitized;
};

const serializeApiHistoryItem = (item: ApiHistory) => ({
  ...item,
  createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
  updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
  responsePayload: sanitizeResponsePayload(item.responsePayload, item.apiType),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const context = await requirePlatformActionContext({
      req,
      action: 'platform.diagnostics.read',
    });
    const workspaceId =
      getQueryString(req.query.workspaceId) ||
      context.validatedSession.workspace.id;
    const workspace = await components.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw createHttpError(404, 'Workspace not found');
    }

    const apiType = parseOptionalApiType(getQueryString(req.query.apiType));
    const statusCode = parseOptionalStatusCode(
      getQueryString(req.query.statusCode),
    );
    const threadId = getQueryString(req.query.threadId) || undefined;
    const startDate = normalizeDateInput(getQueryString(req.query.startDate));
    const endDate = normalizeDateInput(getQueryString(req.query.endDate));
    const offset = parseRequiredPositiveInt(
      getQueryString(req.query.offset),
      'offset',
      0,
    );
    const limit = parseRequiredPositiveInt(
      getQueryString(req.query.limit),
      'limit',
      10,
    );

    const filterCriteria: Partial<ApiHistory> = {
      workspaceId,
      ...(apiType ? { apiType } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(threadId ? { threadId } : {}),
    };
    const dateFilter = {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    const total = await components.apiHistoryRepository.count(
      filterCriteria,
      dateFilter,
    );
    const items =
      total === 0 || total <= offset
        ? []
        : await components.apiHistoryRepository.findAllWithPagination(
            filterCriteria,
            dateFilter,
            {
              offset,
              limit,
              orderBy: { createdAt: 'desc' },
            },
          );

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor: context.actor,
      action: 'platform.diagnostics.read',
      resource: {
        resourceType: 'api_history',
        resourceId: workspaceId,
        workspaceId,
      },
      result: 'allowed',
      context: context.auditContext,
      payloadJson: {
        workspaceId,
        apiType: apiType || null,
        statusCode: statusCode ?? null,
        threadId: threadId || null,
      },
    });

    return res.status(200).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug || null,
      },
      items: items.map(serializeApiHistoryItem),
      total,
      hasMore: offset + limit < total,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load platform diagnostics',
    });
  }
}
