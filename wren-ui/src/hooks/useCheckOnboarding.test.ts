import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useOnboardingStatus, {
  buildOnboardingStatusRequestKey,
  buildOnboardingStatusSelector,
} from './useCheckOnboarding';
import { OnboardingStatus } from '@/types/project';

const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('./useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useCheckOnboarding helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockUseRestRequest.mockReturnValue({
      data: OnboardingStatus.CONNECTION_SAVED,
      loading: false,
      error: null,
      refetch: jest.fn().mockResolvedValue(OnboardingStatus.CONNECTION_SAVED),
    });
  });

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

  it('builds a state-key request key only when onboarding loading is not skipped', () => {
    expect(
      buildOnboardingStatusRequestKey({
        skip: true,
        selector: { workspaceId: 'ws-1' },
      }),
    ).toBeNull();

    expect(
      buildOnboardingStatusRequestKey({
        skip: false,
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1');
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      useOnboardingStatus();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: undefined,
        requestKey: 'ws-1|kb-1|snap-1|deploy-1',
      }),
    );
  });

  it('keeps the current onboarding status contract explicit', () => {
    expect(OnboardingStatus.CONNECTION_SAVED).toBe('CONNECTION_SAVED');
  });
});
