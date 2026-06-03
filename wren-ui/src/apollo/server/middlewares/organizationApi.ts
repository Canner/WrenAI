import { NextApiRequest } from 'next';
import { ApiError } from '../utils/apiUtils';

const getProjectService = () => {
  const { components, initComponents } = require('@/common');
  const componentGraph = components ?? initComponents();
  return componentGraph.projectService;
};

export const assertAllowedMethods = (
  req: NextApiRequest,
  methods: string[],
) => {
  if (!req.method || !methods.includes(req.method)) {
    throw new ApiError('Method not allowed', 405);
  }
};

export const parseOrganizationId = (value: string | string[] | undefined) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError('Invalid organization id', 400);
  }
  return parsed;
};

export const getCurrentProjectName = async () => {
  try {
    const projectService = getProjectService();
    const project = await projectService.getCurrentProject();
    return project?.displayName || 'Default Project';
  } catch {
    return 'Default Project';
  }
};
