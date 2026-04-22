import { Alert } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import buildManageConnectorsControlState from './buildManageConnectorsControlState';
import ConnectorEditorModal from './ConnectorEditorModal';
import ConnectorsCatalogSection from './ConnectorsCatalogSection';
import ConnectorSecretRotationModal from './ConnectorSecretRotationModal';
import useConnectorCatalog from './useConnectorCatalog';
import useConnectorMutationOperations from './useConnectorMutationOperations';
import useConnectorSecretOperations from './useConnectorSecretOperations';
import useManageConnectorsEditorState from './useManageConnectorsEditorState';
import useManageConnectorsRuntimeState from './useManageConnectorsRuntimeState';

export default function ManageConnectorsPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeState = useManageConnectorsRuntimeState({
    authSession,
    runtimeScopeNavigation,
    runtimeScopePage,
  });
  const editorState = useManageConnectorsEditorState({
    createConnectorBlockedReason: runtimeState.createConnectorBlockedReason,
    updateConnectorBlockedReason: runtimeState.updateConnectorBlockedReason,
  });
  const connectorCatalog = useConnectorCatalog({
    enabled: runtimeState.connectorsRequestEnabled,
    workspaceScopedSelector: runtimeState.workspaceScopedSelector,
  });
  const secretOperations = useConnectorSecretOperations({
    rotateConnectorSecretBlockedReason:
      runtimeState.rotateConnectorSecretBlockedReason,
    requireWorkspaceSelector: runtimeState.requireWorkspaceSelector,
  });
  const mutationOperations = useConnectorMutationOperations({
    form: editorState.form,
    editingConnector: editorState.editingConnector,
    clearSecretChecked: editorState.clearSecretChecked,
    createConnectorBlockedReason: runtimeState.createConnectorBlockedReason,
    updateConnectorBlockedReason: runtimeState.updateConnectorBlockedReason,
    deleteConnectorBlockedReason: runtimeState.deleteConnectorBlockedReason,
    requireWorkspaceSelector: runtimeState.requireWorkspaceSelector,
    loadConnectors: connectorCatalog.loadConnectors,
    closeModal: editorState.closeModal,
  });
  const controlState = buildManageConnectorsControlState({
    createConnectorBlockedReason: runtimeState.createConnectorBlockedReason,
    editingConnector: editorState.editingConnector,
    submitting: mutationOperations.submitting,
    updateConnectorBlockedReason: runtimeState.updateConnectorBlockedReason,
    watchedConnectorType: editorState.watchedConnectorType,
  });

  const shellProps = {
    title: '数据连接器',
    ...buildSettingsConsoleShellProps({
      activeKey: 'settingsConnectors',
      onNavigate: runtimeScopeNavigation.pushWorkspace,
      showPlatformAdmin: runtimeState.showPlatformManagement,
    }),
  } as const;

  if (runtimeScopePage.guarding) {
    return <ConsoleShellLayout {...shellProps} loading />;
  }

  return (
    <ConsoleShellLayout
      {...shellProps}
      loading={connectorCatalog.loading || authSession.loading}
    >
      {runtimeState.connectorActionBlockedReason ? (
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          title={runtimeState.connectorActionBlockedReason}
          description={
            runtimeState.connectorScopeRestrictionReason
              ? '当前作用域是系统托管样例空间，仅支持浏览示例数据，不支持新增、编辑、删除或测试连接器。'
              : '当前账号只有连接器浏览权限；如需新增、编辑、测试、删除或轮换密钥，请联系工作区管理员。'
          }
        />
      ) : null}

      <ConnectorsCatalogSection
        connectors={connectorCatalog.connectors}
        configuredSecretCount={connectorCatalog.configuredSecretCount}
        testingConnectorId={mutationOperations.testingConnectorId}
        createConnectorBlockedReason={runtimeState.createConnectorBlockedReason}
        updateConnectorBlockedReason={runtimeState.updateConnectorBlockedReason}
        deleteConnectorBlockedReason={runtimeState.deleteConnectorBlockedReason}
        rotateConnectorSecretBlockedReason={
          runtimeState.rotateConnectorSecretBlockedReason
        }
        onOpenSecretOpsModal={secretOperations.openSecretOpsModal}
        onOpenCreateModal={editorState.openCreateModal}
        onOpenEditModal={editorState.openEditModal}
        onTestSavedConnector={mutationOperations.handleTestSavedConnector}
        onDeleteConnector={mutationOperations.deleteConnector}
      />

      <ConnectorSecretRotationModal
        open={secretOperations.secretOpsModalOpen}
        scopeType={secretOperations.secretScopeType}
        targetKeyVersionText={secretOperations.targetKeyVersionText}
        sourceKeyVersionText={secretOperations.sourceKeyVersionText}
        summary={secretOperations.secretReencryptSummary}
        submittingMode={secretOperations.secretReencryptSubmittingMode}
        rotateBlockedReason={runtimeState.rotateConnectorSecretBlockedReason}
        onClose={secretOperations.closeSecretOpsModal}
        onScopeTypeChange={secretOperations.setSecretScopeType}
        onTargetKeyVersionChange={secretOperations.setTargetKeyVersionText}
        onSourceKeyVersionChange={secretOperations.setSourceKeyVersionText}
        onDryRun={() => secretOperations.handleSecretReencrypt(false)}
        onExecute={() => secretOperations.handleSecretReencrypt(true)}
      />

      <ConnectorEditorModal
        open={editorState.modalOpen}
        editingConnector={editorState.editingConnector}
        form={editorState.form}
        submitting={mutationOperations.submitting}
        testingConnection={mutationOperations.testingConnection}
        watchedConnectorType={editorState.watchedConnectorType}
        watchedDatabaseProvider={editorState.watchedDatabaseProvider}
        watchedSnowflakeAuthMode={editorState.watchedSnowflakeAuthMode}
        watchedRedshiftAuthMode={editorState.watchedRedshiftAuthMode}
        clearSecretChecked={editorState.clearSecretChecked}
        databaseProviderExample={editorState.databaseProviderExample || null}
        connectorTypeOptions={controlState.connectorTypeOptions}
        testDisabled={controlState.modalTestDisabled}
        submitDisabled={controlState.modalSubmitDisabled}
        onCancel={editorState.closeModal}
        onTest={mutationOperations.handleModalTestConnection}
        onSubmit={mutationOperations.submitConnector}
        onClearSecretCheckedChange={editorState.setClearSecretChecked}
      />
    </ConsoleShellLayout>
  );
}
