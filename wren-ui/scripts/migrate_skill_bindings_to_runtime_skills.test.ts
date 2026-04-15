import {
  buildBindingSignature,
  groupBindingsBySignature,
  parseCliArgs,
} from './migrate_skill_bindings_to_runtime_skills';

describe('migrate_skill_bindings_to_runtime_skills', () => {
  it('parses cli options with dry-run as default', () => {
    expect(parseCliArgs([])).toEqual({ execute: false });
    expect(parseCliArgs(['--execute', '--workspace', 'ws-1'])).toEqual({
      execute: true,
      workspaceId: 'ws-1',
    });
  });

  it('builds stable signatures for semantically equal bindings', () => {
    const left = buildBindingSignature({
      id: 'binding-1',
      knowledge_base_id: 'kb-1',
      skill_definition_id: 'skill-1',
      enabled: true,
      connector_id: 'connector-1',
      binding_config: {
        timeoutSec: 30,
        tool: {
          mode: 'summary',
          locale: 'zh-CN',
        },
      },
    });
    const right = buildBindingSignature({
      id: 'binding-2',
      knowledge_base_id: 'kb-2',
      skill_definition_id: 'skill-1',
      enabled: true,
      connector_id: 'connector-1',
      binding_config: {
        tool: {
          locale: 'zh-CN',
          mode: 'summary',
        },
        timeoutSec: 30,
      },
    });

    expect(left).toBe(right);
  });

  it('groups bindings by runtime signature instead of knowledge base id', () => {
    const groups = groupBindingsBySignature([
      {
        id: 'binding-2',
        knowledge_base_id: 'kb-2',
        skill_definition_id: 'skill-1',
        enabled: true,
        connector_id: 'connector-1',
        binding_config: { timeoutSec: 30 },
      },
      {
        id: 'binding-1',
        knowledge_base_id: 'kb-1',
        skill_definition_id: 'skill-1',
        enabled: true,
        connector_id: 'connector-1',
        binding_config: { timeoutSec: 30 },
      },
      {
        id: 'binding-3',
        knowledge_base_id: 'kb-3',
        skill_definition_id: 'skill-1',
        enabled: false,
        connector_id: 'connector-2',
        binding_config: { timeoutSec: 45 },
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].bindings.map((binding) => binding.id)).toEqual([
      'binding-1',
      'binding-2',
    ]);
    expect(groups[1].bindings.map((binding) => binding.id)).toEqual([
      'binding-3',
    ]);
  });
});
