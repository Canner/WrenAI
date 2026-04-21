import CodeOutlined from '@ant-design/icons/CodeOutlined';
import { Space } from 'antd';
import { useMemo } from 'react';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import SkillDefinitionModal from './SkillDefinitionModal';
import SkillDefinitionsSection from './SkillDefinitionsSection';
import SkillsMarketplaceSection from './SkillsMarketplaceSection';
import SkillsMetricsGrid from './SkillsMetricsGrid';
import { resolveSkillManagementCapabilities } from './skillsPageUtils';
import useSkillDefinitionModal from './useSkillDefinitionModal';
import useSkillDefinitionOperations from './useSkillDefinitionOperations';
import useSkillsPageData from './useSkillsPageData';

export default function ManageSkillsPage() {
  const {
    runtimeScopePage,
    runtimeScopeNavigation,
    runtimeSelectorState,
    marketplaceCatalogSkills,
    skillDefinitions,
    connectors,
    connectorsLoading,
    connectorOptions,
    connectorsHref,
    installedCatalogIds,
    enabledSkillCount,
    loading,
    refresh,
  } = useSkillsPageData();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsSkills',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
    hideHeader: false,
    contentBorderless: false,
  });
  const {
    canCreateSkill,
    canUpdateSkill,
    canDeleteSkill,
    skillManagementBlockedReason,
  } = useMemo(
    () =>
      resolveSkillManagementCapabilities(
        authSession.data?.authorization?.actions,
      ),
    [authSession.data?.authorization?.actions],
  );
  const definitionModal = useSkillDefinitionModal({
    canCreateSkill,
    canUpdateSkill,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    refresh,
  });
  const skillOperations = useSkillDefinitionOperations({
    canCreateSkill,
    canUpdateSkill,
    canDeleteSkill,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    refresh,
  });

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        title="技能管理"
        description="管理工作区级运行时技能，并配置其指令、执行模式与连接器。"
        eyebrow="Workspace Skills"
        loading
        {...shellProps}
      />
    );
  }

  return (
    <ConsoleShellLayout
      loading={loading || authSession.loading}
      title={
        <>
          <CodeOutlined className="mr-2 gray-8" />
          技能管理
        </>
      }
      description="以 workspace runtime skill 为主模型管理技能：市场负责发布来源，skill_definition 负责实际运行时配置。"
      eyebrow="Workspace Skills"
      {...shellProps}
    >
      <SkillsMetricsGrid
        workspaceName={runtimeSelectorState?.currentWorkspace?.name}
        knowledgeBaseName={runtimeSelectorState?.currentKnowledgeBase?.name}
        skillDefinitionCount={skillDefinitions.length}
        enabledSkillCount={enabledSkillCount}
        marketplaceSkillCount={marketplaceCatalogSkills.length}
      />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <SkillsMarketplaceSection
          marketplaceCatalogSkills={marketplaceCatalogSkills}
          installedCatalogIds={installedCatalogIds}
          canCreateSkill={canCreateSkill}
          installingCatalogId={skillOperations.installingCatalogId}
          skillManagementBlockedReason={skillManagementBlockedReason}
          onInstallSkill={skillOperations.handleInstallSkill}
        />
        <SkillDefinitionsSection
          skillDefinitions={skillDefinitions}
          connectors={connectors}
          connectorsHref={connectorsHref}
          currentKnowledgeBaseId={
            runtimeSelectorState?.currentKnowledgeBase?.id
          }
          currentKnowledgeBaseName={
            runtimeSelectorState?.currentKnowledgeBase?.name
          }
          canCreateSkill={canCreateSkill}
          canUpdateSkill={canUpdateSkill}
          canDeleteSkill={canDeleteSkill}
          togglingSkillId={skillOperations.togglingSkillId}
          deletingSkillId={skillOperations.deletingSkillId}
          onOpenCreateDefinitionModal={
            definitionModal.openCreateDefinitionModal
          }
          onOpenEditDefinitionModal={definitionModal.openEditDefinitionModal}
          onToggleSkill={skillOperations.handleToggleSkill}
          onDeleteSkill={skillOperations.handleDeleteSkill}
        />
      </Space>

      <SkillDefinitionModal
        open={definitionModal.definitionModalOpen}
        editingDefinition={definitionModal.editingDefinition}
        form={definitionModal.definitionForm}
        confirmLoading={definitionModal.definitionSubmitting}
        connectorsLoading={connectorsLoading}
        connectorOptions={connectorOptions}
        clearDefinitionSecretChecked={
          definitionModal.clearDefinitionSecretChecked
        }
        onClearDefinitionSecretCheckedChange={
          definitionModal.setClearDefinitionSecretChecked
        }
        onCancel={definitionModal.closeDefinitionModal}
        onSubmit={definitionModal.submitDefinition}
      />
    </ConsoleShellLayout>
  );
}
