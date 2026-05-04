import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
  validateSql,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_SQL_PAIR_BY_ID');
logger.level = 'debug';

const { projectService, sqlPairService, deployService, queryService } =
  components;

/**
 * SQL Pairs API - Manages SQL query and question pairs for knowledge base
 */
interface UpdateSqlPairRequest {
  sql?: string;
  question?: string;
}

/**
 * Validate SQL pair ID from request query
 */
const validateSqlPairId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('SQL pair ID is required', 400);
  }

  const sqlPairId = parseInt(id, 10);
  if (isNaN(sqlPairId)) {
    throw new ApiError('Invalid SQL pair ID', 400);
  }

  return sqlPairId;
};

/**
 * Handle PUT request - update an existing SQL pair
 */
const handleUpdateSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  const { id } = req.query;
  const sqlPairId = validateSqlPairId(id);

  const { sql, question } = req.body as UpdateSqlPairRequest;

  // Input validation for provided fields
  if (sql !== undefined) {
    if (!sql) {
      throw new ApiError('SQL cannot be empty', 400);
    }
    if (sql.length > 10000) {
      throw new ApiError('SQL is too long (max 10000 characters)', 400);
    }
    // Validate SQL syntax and compatibility
    await validateSql(sql, project, deployService, queryService);
  }

  if (question !== undefined) {
    if (!question) {
      throw new ApiError('Question cannot be empty', 400);
    }
    if (question.length > 1000) {
      throw new ApiError('Question is too long (max 1000 characters)', 400);
    }
  }

  // Update the SQL pair
  const updatedSqlPair = await sqlPairService.editSqlPair(
    project.id,
    sqlPairId,
    {
      sql,
      question,
    },
  );

  // Return the updated SQL pair directly
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: updatedSqlPair,
    projectId: project.id,
    apiType: ApiType.UPDATE_SQL_PAIR,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle DELETE request - delete a SQL pair
 */
const handleDeleteSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  const { id } = req.query;
  const sqlPairId = validateSqlPairId(id);

  // Delete the SQL pair
  await sqlPairService.deleteSqlPair(project.id, sqlPairId);

  // Return 204 No Content with no payload
  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    projectId: project.id,
    apiType: ApiType.DELETE_SQL_PAIR,
    startTime,
    requestPayload: { id: sqlPairId },
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Handle PUT method - update SQL pair
    if (req.method === 'PUT') {
      await handleUpdateSqlPair(req, res, project, startTime);
      return;
    }

    // Handle DELETE method - delete SQL pair
    if (req.method === 'DELETE') {
      await handleDeleteSqlPair(req, res, project, startTime);
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_SQL_PAIR
          : ApiType.DELETE_SQL_PAIR,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
