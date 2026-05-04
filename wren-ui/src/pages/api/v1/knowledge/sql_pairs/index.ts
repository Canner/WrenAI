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

const logger = getLogger('API_SQL_PAIRS');
logger.level = 'debug';

const { projectService, sqlPairService, deployService, queryService } =
  components;

/**
 * SQL Pairs API - Manages SQL query and question pairs for knowledge base
 */
interface CreateSqlPairRequest {
  sql: string;
  question: string;
}

/**
 * Handle GET request - list all SQL pairs for the current project
 */
const handleGetSqlPairs = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  // Get all SQL pairs for the current project
  const sqlPairs = await sqlPairService.getProjectSqlPairs(project.id);

  // Return the SQL pairs array directly
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: sqlPairs,
    projectId: project.id,
    apiType: ApiType.GET_SQL_PAIRS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle POST request - create a new SQL pair
 */
const handleCreateSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  const { sql, question } = req.body as CreateSqlPairRequest;

  // Input validation
  if (!sql) {
    throw new ApiError('SQL is required', 400);
  }

  if (!question) {
    throw new ApiError('Question is required', 400);
  }

  if (sql.length > 10000) {
    throw new ApiError('SQL is too long (max 10000 characters)', 400);
  }

  if (question.length > 1000) {
    throw new ApiError('Question is too long (max 1000 characters)', 400);
  }

  // Validate SQL syntax and compatibility
  await validateSql(sql, project, deployService, queryService);

  // Create the SQL pair
  const newSqlPair = await sqlPairService.createSqlPair(project.id, {
    sql,
    question,
  });

  // Return the created SQL pair directly
  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: newSqlPair,
    projectId: project.id,
    apiType: ApiType.CREATE_SQL_PAIR,
    startTime,
    requestPayload: req.body,
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

    // Handle GET method - list SQL pairs
    if (req.method === 'GET') {
      await handleGetSqlPairs(req, res, project, startTime);
      return;
    }

    // Handle POST method - create SQL pair
    if (req.method === 'POST') {
      await handleCreateSqlPair(req, res, project, startTime);
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
        req.method === 'GET' ? ApiType.GET_SQL_PAIRS : ApiType.CREATE_SQL_PAIR,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
