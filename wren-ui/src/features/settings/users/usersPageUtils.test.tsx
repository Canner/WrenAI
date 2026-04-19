import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  applicationStatusColor,
  renderSourceDetails,
  resolveRoleSourceSummary,
} from './usersPageUtils';

describe('usersPageUtils', () => {
  it('exposes role and status labels', () => {
    expect(ROLE_LABELS.owner).toBe('所有者');
    expect(STATUS_LABELS.pending).toBe('待审批');
    expect(applicationStatusColor('active')).toBe('green');
    expect(applicationStatusColor('unknown')).toBe('default');
  });

  it('renders source details and fallback role source summary', () => {
    const directMarkup = renderToStaticMarkup(
      <>{renderSourceDetails([{ kind: 'group_binding', label: '目录组' }])}</>,
    );
    const fallbackMarkup = renderToStaticMarkup(
      <>
        {
          resolveRoleSourceSummary({
            workspaceRoleSource: 'role_binding',
            platformRoleSource: 'legacy',
          }).workspace
        }
        {
          resolveRoleSourceSummary({
            workspaceRoleSource: 'role_binding',
            platformRoleSource: 'legacy',
          }).platform
        }
      </>,
    );

    expect(directMarkup).toContain('目录组');
    expect(fallbackMarkup).toContain('结构化角色绑定');
    expect(fallbackMarkup).toContain('Legacy 兼容来源');
  });
});
