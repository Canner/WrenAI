import {
  applyRuntimeSelectorToRedirectPath,
  buildAuthPathWithError,
  buildAuthPathWithRedirect,
  sanitizeLocalRedirectPath,
} from './authRedirect';

describe('authRedirect utils', () => {
  it('sanitizes only local non-auth redirect paths', () => {
    expect(sanitizeLocalRedirectPath('/workspace?tab=members')).toBe(
      '/workspace?tab=members',
    );
    expect(sanitizeLocalRedirectPath('https://evil.example.com')).toBeNull();
    expect(sanitizeLocalRedirectPath('//evil.example.com')).toBeNull();
    expect(sanitizeLocalRedirectPath('/auth')).toBeNull();
  });

  it('merges runtime selector into redirect path', () => {
    expect(
      applyRuntimeSelectorToRedirectPath('/workspace?tab=members', {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    ).toBe(
      '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snapshot-1&deployHash=deploy-1',
    );
  });

  it('builds auth redirect and error query safely', () => {
    expect(buildAuthPathWithRedirect('/workspace')).toBe(
      '/auth?redirectTo=%2Fworkspace',
    );
    expect(
      buildAuthPathWithError({
        redirectTo: '/workspace',
        error: 'failed',
      }),
    ).toBe('/auth?redirectTo=%2Fworkspace&error=failed');
  });
});
