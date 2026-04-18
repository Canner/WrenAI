import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { OnboardingStatus } from '@/types/project';

import { parseRestJsonResponse } from './rest';

export type OnboardingStatusResponse = {
  status?: OnboardingStatus | null;
};

export const buildOnboardingStatusUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/onboarding/status', {}, selector);

export const fetchOnboardingStatus = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
  options: { signal?: AbortSignal } = {},
) => {
  const response = await fetch(buildOnboardingStatusUrl(selector), {
    signal: options.signal,
  });
  const payload = await parseRestJsonResponse<OnboardingStatusResponse>(
    response,
    '加载引导状态失败，请稍后重试。',
  );
  return payload;
};
