import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import type { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { parseRestJsonResponse } from './rest';

export type OnboardingStatusResponse = {
  status?: OnboardingStatus | null;
};

export const buildOnboardingStatusUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/onboarding/status', {}, selector);

export const fetchOnboardingStatus = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(buildOnboardingStatusUrl(selector));
  return parseRestJsonResponse<OnboardingStatusResponse>(
    response,
    '加载引导状态失败，请稍后重试。',
  );
};
