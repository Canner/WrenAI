import { Path } from '@/utils/enum';
import {
  resolveAuthRedirectPath,
  resolveLoginSuccessRedirectPath,
} from './auth';

describe('resolveAuthRedirectPath', () => {
  it('returns runtime-scoped home path for authenticated sessions with workspace context', () => {
    expect(
      resolveAuthRedirectPath(
        {
          authenticated: true,
          runtimeSelector: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        },
        '/workspace?tab=members',
      ),
    ).toBe(
      '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snapshot-1&deployHash=deploy-1',
    );
  });

  it('falls back to onboarding when authenticated session has no runtime selector yet', () => {
    expect(
      resolveAuthRedirectPath({
        authenticated: true,
      }),
    ).toBe(Path.OnboardingConnection);
  });

  it('stays on auth for unauthenticated users', () => {
    expect(
      resolveAuthRedirectPath({
        authenticated: false,
      }),
    ).toBe(Path.Auth);
  });
});

describe('resolveLoginSuccessRedirectPath', () => {
  it('uses runtime selector when login payload includes full runtime scope', () => {
    expect(
      resolveLoginSuccessRedirectPath(
        {
          runtimeSelector: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        },
        '/settings?section=security',
      ),
    ).toBe(
      '/settings?section=security&workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snapshot-1&deployHash=deploy-1',
    );
  });

  it('falls back to workspace-scoped home redirect when login only returns workspace', () => {
    expect(
      resolveLoginSuccessRedirectPath({
        workspace: {
          id: 'workspace-1',
        },
      }),
    ).toBe('/home?workspaceId=workspace-1');
  });

  it('falls back to onboarding when login payload lacks workspace context', () => {
    expect(resolveLoginSuccessRedirectPath({})).toBe(Path.OnboardingConnection);
  });

  it('ignores unsafe redirect targets', () => {
    expect(
      resolveLoginSuccessRedirectPath(
        {
          workspace: {
            id: 'workspace-1',
          },
        },
        'https://evil.example.com/phish',
      ),
    ).toBe('/home?workspaceId=workspace-1');
  });
});
