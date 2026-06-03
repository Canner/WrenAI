import { NextApiRequest } from 'next';
import { ApiError } from '../utils/apiUtils';

const getProjectService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.projectService;
};

export const getCurrentProjectContext = async () => {
  try {
    const projectService = getProjectService();
    const project = await projectService.getCurrentProject();
    return {
      id: project?.id ?? null,
      displayName: project?.displayName || 'Default Project',
    };
  } catch {
    return {
      id: null,
      displayName: 'Default Project',
    };
  }
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
  const project = await getCurrentProjectContext();
  return project.displayName;
};
