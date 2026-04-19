import {
  BREAK_GLASS_DURATION_OPTIONS,
  BREAK_GLASS_ROLE_OPTIONS,
  buildCopiedWorkspaceRoleName,
  countActiveBreakGlassGrants,
  getAccessReviewDecisionColor,
  getAccessReviewStatusColor,
  normalizeWorkspaceRoleNameInput,
  PERMISSION_PRINCIPAL_TYPE_OPTIONS,
  PERMISSION_ROLE_LABELS,
  summarizePermissionDiff,
} from './permissionsPageUtils';

describe('permissionsPageUtils', () => {
  it('exposes workspace permission role labels and options', () => {
    expect(PERMISSION_ROLE_LABELS.owner).toBe('所有者');
    expect(PERMISSION_ROLE_LABELS.admin).toBe('管理员');
    expect(PERMISSION_ROLE_LABELS.member).toBe('成员');
    expect(PERMISSION_PRINCIPAL_TYPE_OPTIONS).toHaveLength(3);
    expect(BREAK_GLASS_ROLE_OPTIONS).toHaveLength(3);
    expect(BREAK_GLASS_DURATION_OPTIONS).toHaveLength(4);
  });

  it('computes review/break-glass helper states', () => {
    expect(
      countActiveBreakGlassGrants([
        { status: 'active', revokedAt: null },
        { status: 'active', revokedAt: '2026-04-18T00:00:00Z' },
        { status: 'inactive', revokedAt: null },
      ]),
    ).toBe(1);
    expect(getAccessReviewStatusColor('completed')).toBe('green');
    expect(getAccessReviewStatusColor('in_progress')).toBe('gold');
    expect(getAccessReviewDecisionColor('keep')).toBe('green');
    expect(getAccessReviewDecisionColor('remove')).toBe('red');
    expect(getAccessReviewDecisionColor(undefined)).toBe('gold');
  });

  it('normalizes copied role names and summarizes permission diffs', () => {
    expect(normalizeWorkspaceRoleNameInput(' Finance Admin ')).toBe(
      'finance_admin',
    );
    expect(
      buildCopiedWorkspaceRoleName({
        sourceName: 'finance_admin',
        existingNames: ['finance_admin_copy', 'finance_admin_copy_2'],
      }),
    ).toBe('finance_admin_copy_3');
    expect(
      summarizePermissionDiff(
        ['workspace.read', 'knowledge_base.read'],
        ['workspace.read', 'connector.update', 'knowledge_base.read'],
      ),
    ).toEqual({
      added: 1,
      removed: 0,
    });
  });
});
