import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  ApiType,
  ApiStatus,
  ApiHistory,
} from '@server/repositories/apiHistoryRepository';
import {
  AskResult,
  AskResultStatus,
  WrenAILanguage,
} from '@/apollo/server/models/adaptor';

const { apiHistoryRepository, projectService, deployService, wrenAIAdaptor } =
  components;

interface GenerateSqlRequest {
  question: string;
  threadId?: number;
}

const isAskResultFinished = (result: AskResult) => {
  return (
    result.status === AskResultStatus.FINISHED ||
    result.status === AskResultStatus.FAILED ||
    result.status === AskResultStatus.STOPPED ||
    result.error
  );
};

const transformHistoryInput = (histories: ApiHistory[]) => {
  if (!histories) {
    return [];
  }
  return histories
    .filter((history) => history.responsePayload?.sql)
    .map((history) => ({
      question: history.input.question,
      sql: history.responsePayload?.sql,
    }));
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const { question, threadId } = req.body as GenerateSqlRequest;

  try {
    // 1. Validation
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // 2. Get current project
    const project = await projectService.getCurrentProject();
    const lastDeploy = await deployService.getLastDeployment(project.id);

    // 3. Ask AI service to generate SQL
    const histories = threadId
      ? await apiHistoryRepository.findAllBy({ threadId })
      : undefined;
    const task = await wrenAIAdaptor.ask({
      query: question,
      deployId: lastDeploy.hash,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    });

    // 4. Poll for the result
    let result: AskResult;
    while (true) {
      result = await wrenAIAdaptor.getAskResult(task.queryId);
      if (isAskResultFinished(result)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }

    const durationMs = Date.now() - startTime;

    // 5. Log API request in history
    await apiHistoryRepository.createOne({
      projectId: project.id,
      apiType: ApiType.GENERATE_SQL,
      threadId,
      input: { question, threadId },
      headers: req.headers as Record<string, string>,
      requestPayload: req.body,
      responsePayload: result,
      status: result.error ? ApiStatus.FAILED : ApiStatus.SUCCESS,
      durationMs,
    });

    // 6. If there was an error, return it
    if (result.error) {
      return res.status(400).json({
        error: result.error.message,
        code: result.error.code,
      });
    }

    // 7. Return successful response with SQL
    return res.status(200).json({
      sql: result.response?.[0]?.sql,
    });
  } catch (error) {
    console.error('Error generating SQL:', error);

    // Log error in API history
    try {
      const project = await projectService.getCurrentProject();
      await apiHistoryRepository.createOne({
        projectId: project.id,
        apiType: ApiType.GENERATE_SQL,
        threadId,
        input: { question, threadId },
        headers: req.headers,
        requestPayload: req.body,
        responsePayload: { error: error.message },
        status: ApiStatus.FAILED,
        durationMs: Date.now() - startTime,
      });
    } catch (logError) {
      console.error('Error logging API history:', logError);
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
