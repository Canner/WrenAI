import {
  getModuleKey,
  getPermissionDescription,
  getPermissionHeadline,
  normalizeRoleNameInput,
} from './platformPermissionsMeta';

describe('platformPermissionsMeta', () => {
  it('keeps system task permissions in the observability module', () => {
    expect(getModuleKey('platform.system_task.read')).toBe('observability');
    expect(getModuleKey('platform.system_task.manage')).toBe('observability');
  });

  it('keeps high-risk platform actions in the security module', () => {
    expect(getModuleKey('break_glass.manage')).toBe('security');
    expect(getModuleKey('impersonation.start')).toBe('security');
  });

  it('returns curated platform headlines and descriptions for system task permissions', () => {
    expect(getPermissionHeadline('platform.system_task.manage')).toBe(
      '管理系统任务',
    );
    expect(
      getPermissionDescription({
        name: 'platform.system_task.manage',
        description: 'fallback',
        scope: 'platform',
      }),
    ).toBe('允许执行平台系统任务管理动作。');
  });

  it('normalizes custom platform role keys into a stable slug', () => {
    expect(normalizeRoleNameInput(' Workspace Operator / APAC ')).toBe(
      'workspace_operator_apac',
    );
  });
});
