import { canShowPlatformManagement } from '@/features/settings/settingsPageCapabilities';
import { getConnectorScopeRestrictionReason } from '@/utils/workspaceGovernance';

type AuthorizationActions = Record<string, boolean> | null | undefined;

export type ConnectorManagementCapabilityInput = {
  workspaceKind?: string | null;
  authorizationActions?: AuthorizationActions;
  platformRoleKeys?: string[] | null;
  actorIsPlatformAdmin?: boolean | null;
  sessionIsPlatformAdmin?: boolean | null;
};

export const resolveConnectorManagementCapabilities = ({
  workspaceKind,
  authorizationActions,
  platformRoleKeys,
  actorIsPlatformAdmin,
  sessionIsPlatformAdmin,
}: ConnectorManagementCapabilityInput) => {
  const showPlatformManagement = canShowPlatformManagement({
    platformRoleKeys,
    actorIsPlatformAdmin,
    sessionIsPlatformAdmin,
  });
  const connectorScopeRestrictionReason = getConnectorScopeRestrictionReason({
    workspaceKind,
    knowledgeBaseKind: null,
  });
  const actions = authorizationActions || {};
  const hasAuthCapabilities = Object.keys(actions).length > 0;
  const canCreateConnector = hasAuthCapabilities
    ? Boolean(actions['connector.create'])
    : true;
  const canUpdateConnector = hasAuthCapabilities
    ? Boolean(actions['connector.update'])
    : true;
  const canDeleteConnector = hasAuthCapabilities
    ? Boolean(actions['connector.delete'])
    : true;
  const canRotateConnectorSecret = hasAuthCapabilities
    ? Boolean(actions['connector.rotate_secret'])
    : true;
  const connectorPermissionBlockedReason =
    canCreateConnector ||
    canUpdateConnector ||
    canDeleteConnector ||
    canRotateConnectorSecret
      ? null
      : '当前账号没有连接器管理权限';
  const connectorActionBlockedReason =
    connectorScopeRestrictionReason || connectorPermissionBlockedReason;
  const createConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canCreateConnector
      ? null
      : '当前账号没有创建连接器权限';
  const updateConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canUpdateConnector
      ? null
      : '当前账号没有编辑或测试连接器权限';
  const deleteConnectorBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canDeleteConnector
      ? null
      : '当前账号没有删除连接器权限';
  const rotateConnectorSecretBlockedReason = connectorScopeRestrictionReason
    ? connectorScopeRestrictionReason
    : canRotateConnectorSecret
      ? null
      : '当前账号没有批量轮换密钥权限';

  return {
    showPlatformManagement,
    connectorScopeRestrictionReason,
    canCreateConnector,
    canUpdateConnector,
    canDeleteConnector,
    canRotateConnectorSecret,
    connectorPermissionBlockedReason,
    connectorActionBlockedReason,
    createConnectorBlockedReason,
    updateConnectorBlockedReason,
    deleteConnectorBlockedReason,
    rotateConnectorSecretBlockedReason,
  };
};
