import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';

export type ConnectorView = {
  id: string;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  displayName: string;
  config?: Record<string, any> | null;
  hasSecret?: boolean;
  createdBy?: string | null;
};

export type SkillDefinitionFormValues = {
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string;
  entrypoint?: string;
  manifestText?: string;
  secretText?: string;
  instruction?: string;
  executionMode?: 'inject_only';
  connectorId?: string;
  enabled?: boolean;
  kbSuggestionIdsText?: string;
  runtimeConfigText?: string;
};

export type SkillManagementCapabilities = {
  canCreateSkill: boolean;
  canUpdateSkill: boolean;
  canDeleteSkill: boolean;
  canManageAnySkillAction: boolean;
  skillManagementBlockedReason: string | null;
};

export const buildSkillConnectorOptions = (connectors: ConnectorView[]) => [
  { label: '无连接器', value: '' },
  ...connectors.map((connector) => ({
    label: `${connector.displayName} (${connector.type})`,
    value: connector.id,
  })),
];

export const buildSkillConnectorsApiUrl = (
  selector?: Parameters<typeof buildRuntimeScopeUrl>[2],
) => buildRuntimeScopeUrl('/api/v1/connectors', {}, selector);

export const SKILL_SECRET_EDIT_HINT =
  '技能密钥仅作为后端运行时上下文使用，不会在前端回显明文。留空表示保留现有密钥。';
export const SKILL_CLEAR_SECRET_LABEL = '清空现有技能密钥';

const parseOptionalJsonObject = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('JSON 内容必须是对象');
  }

  return parsed;
};

const parseOptionalStringArray = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

export const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

export const stringifyStringArray = (values?: string[] | null) =>
  Array.isArray(values) && values.length > 0 ? values.join('\n') : '';

export const buildSkillDefinitionSubmitPayload = ({
  values,
  editing,
  clearSecret,
}: {
  values: SkillDefinitionFormValues;
  editing: boolean;
  clearSecret: boolean;
}) => {
  const payload: Record<string, any> = {
    name: values.name.trim(),
    runtimeKind: values.runtimeKind?.trim() || undefined,
    sourceType: values.sourceType?.trim() || undefined,
    sourceRef: values.sourceRef?.trim() || null,
    entrypoint: values.entrypoint?.trim() || null,
    manifest: parseOptionalJsonObject(values.manifestText),
    instruction: values.instruction?.trim() || null,
    executionMode: values.executionMode || 'inject_only',
    connectorId: values.connectorId?.trim() || null,
    isEnabled: values.enabled ?? true,
    runtimeConfig: parseOptionalJsonObject(values.runtimeConfigText),
    kbSuggestionIds: parseOptionalStringArray(values.kbSuggestionIdsText),
  };

  if (editing && clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secretText = values.secretText?.trim();
  if (!editing || secretText) {
    payload.secret = parseOptionalJsonObject(values.secretText);
  }

  return payload;
};

export const getInstalledFromLabel = (installedFrom?: string | null) => {
  switch (installedFrom) {
    case 'builtin':
      return '内置';
    case 'marketplace':
      return '市场';
    case 'migrated_from_binding':
      return '迁移';
    default:
      return '自建';
  }
};

export const resolveSkillManagementCapabilities = (
  authorizationActions?: Record<string, boolean>,
): SkillManagementCapabilities => {
  const normalizedActions = authorizationActions || {};
  const hasAuthCapabilities = Object.keys(normalizedActions).length > 0;
  const canCreateSkill = hasAuthCapabilities
    ? Boolean(normalizedActions['skill.create'])
    : true;
  const canUpdateSkill = hasAuthCapabilities
    ? Boolean(normalizedActions['skill.update'])
    : true;
  const canDeleteSkill = hasAuthCapabilities
    ? Boolean(normalizedActions['skill.delete'])
    : true;
  const canManageAnySkillAction =
    canCreateSkill || canUpdateSkill || canDeleteSkill;

  return {
    canCreateSkill,
    canUpdateSkill,
    canDeleteSkill,
    canManageAnySkillAction,
    skillManagementBlockedReason: canManageAnySkillAction
      ? null
      : '当前账号没有技能管理权限',
  };
};

export const normalizeSkillConnectorsPayload = (
  payload: unknown,
): ConnectorView[] =>
  Array.isArray(payload) ? (payload as ConnectorView[]) : [];
