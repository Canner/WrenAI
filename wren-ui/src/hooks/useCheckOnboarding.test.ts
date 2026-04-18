import { buildOnboardingStatusSelector } from './useCheckOnboarding';
import { OnboardingStatus } from '@/types/project';

describe('useCheckOnboarding helpers', () => {
  it('normalizes the onboarding request selector to explicit runtime scope fields only', () => {
    expect(
      buildOnboardingStatusSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: '',
        deployHash: 'deploy-1',
        runtimeScopeId: undefined,
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-1',
    });
  });

  it('keeps the current onboarding status contract explicit', () => {
    expect(OnboardingStatus.CONNECTION_SAVED).toBe('CONNECTION_SAVED');
  });
});
