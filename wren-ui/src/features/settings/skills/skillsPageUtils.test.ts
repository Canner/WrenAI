import {
  buildSkillConnectorOptions,
  buildSkillDefinitionSubmitPayload,
  getInstalledFromLabel,
  normalizeSkillConnectorsPayload,
  resolveSkillManagementCapabilities,
  stringifyJson,
  stringifyStringArray,
} from './skillsPageUtils';

describe('skillsPageUtils', () => {
  it('builds connector select options with an empty sentinel option', () => {
    expect(
      buildSkillConnectorOptions([
        {
          id: 'connector-1',
          workspaceId: 'workspace-1',
          type: 'postgres',
          displayName: 'Warehouse',
        },
      ]),
    ).toEqual([
      { label: '无连接器', value: '' },
      { label: 'Warehouse (postgres)', value: 'connector-1' },
    ]);
  });

  it('builds skill submit payload and deduplicates kb suggestion ids', () => {
    expect(
      buildSkillDefinitionSubmitPayload({
        editing: false,
        clearSecret: false,
        values: {
          name: ' Revenue helper ',
          runtimeKind: ' isolated_python ',
          sourceType: ' inline ',
          sourceRef: ' ref ',
          entrypoint: ' main:run ',
          instruction: ' use revenue rules ',
          connectorId: ' connector-1 ',
          enabled: true,
          kbSuggestionIdsText: 'kb-1\nkb-2\nkb-1',
          runtimeConfigText: '{"timeoutSec": 30}',
          manifestText: '{"network":{"allow":["api.example.com"]}}',
          secretText: '{"token":"secret"}',
        },
      }),
    ).toEqual({
      name: 'Revenue helper',
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      sourceRef: 'ref',
      entrypoint: 'main:run',
      manifest: { network: { allow: ['api.example.com'] } },
      instruction: 'use revenue rules',
      executionMode: 'inject_only',
      connectorId: 'connector-1',
      isEnabled: true,
      runtimeConfig: { timeoutSec: 30 },
      kbSuggestionIds: ['kb-1', 'kb-2'],
      secret: { token: 'secret' },
    });
  });

  it('clears secret when editing and clear secret is requested', () => {
    expect(
      buildSkillDefinitionSubmitPayload({
        editing: true,
        clearSecret: true,
        values: {
          name: 'skill',
        },
      }),
    ).toMatchObject({
      name: 'skill',
      secret: null,
    });
  });

  it('normalizes connectors payload and capability defaults', () => {
    expect(normalizeSkillConnectorsPayload(null)).toEqual([]);
    expect(resolveSkillManagementCapabilities()).toMatchObject({
      canCreateSkill: true,
      canUpdateSkill: true,
      canDeleteSkill: true,
      skillManagementBlockedReason: null,
    });
    expect(
      resolveSkillManagementCapabilities({
        'skill.create': false,
        'skill.update': false,
        'skill.delete': false,
      }),
    ).toMatchObject({
      canManageAnySkillAction: false,
      skillManagementBlockedReason: '当前账号没有技能管理权限',
    });
  });

  it('formats display helpers', () => {
    expect(getInstalledFromLabel('marketplace')).toBe('市场');
    expect(getInstalledFromLabel('unknown')).toBe('自建');
    expect(stringifyJson({ a: 1 })).toContain('"a": 1');
    expect(stringifyStringArray(['kb-1', 'kb-2'])).toBe('kb-1\nkb-2');
  });
});
