import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { replaceAllowableSyntax, validateDisplayName } from '@server/utils';
import {
  ModelServiceDependencies,
  ValidateCalculatedFieldResponse,
} from './modelServiceTypes';
import { getViewsByRuntimeIdentity } from './modelServiceRuntimeScopeSupport';

export const validateViewNameByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  viewDisplayName: string,
  selfView?: number,
): Promise<ValidateCalculatedFieldResponse> => {
  const { valid, message } = validateDisplayName(viewDisplayName);
  if (!valid) {
    return { valid: false, message: message || undefined };
  }

  const referenceName = replaceAllowableSyntax(viewDisplayName);
  const views = await getViewsByRuntimeIdentity(deps, runtimeIdentity);
  if (
    views.find((view) => view.name === referenceName && view.id !== selfView)
  ) {
    return {
      valid: false,
      message: `Generated view name "${referenceName}" is duplicated`,
    };
  }

  return { valid: true };
};
