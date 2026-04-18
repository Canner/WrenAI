import type { NextApiRequest, NextApiResponse } from 'next';
import { SampleDatasetName } from '@server/data';
import { components } from '@/common';
import { ApiError } from '@/server/utils/apiUtils';
import { sendRestApiError } from '../../restApi';

const isE2EInternalRequest = (req: NextApiRequest) => {
  const header = req.headers['x-wren-e2e-internal'];
  return Array.isArray(header) ? header.includes('1') : header === '1';
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    if (!isE2EInternalRequest(req)) {
      throw new ApiError('Internal E2E access required', 403);
    }

    const sampleDataset = String(req.body?.sampleDataset || '')
      .trim()
      .toUpperCase() as SampleDatasetName;
    if (!sampleDataset) {
      throw new ApiError('Sample dataset is required', 400);
    }
    if (!Object.values(SampleDatasetName).includes(sampleDataset)) {
      throw new ApiError(`Unsupported sample dataset: ${sampleDataset}`, 400);
    }

    const { workspace, knowledgeBase } =
      await components.workspaceBootstrapService.ensureDefaultWorkspaceSampleRuntime(
        {
          sampleDataset,
        },
      );

    return res.status(200).json({
      workspaceId: workspace.id,
      knowledgeBaseId: knowledgeBase.id,
    });
  } catch (error) {
    return sendRestApiError(res, error, '系统样例预热失败，请稍后重试。');
  }
}
