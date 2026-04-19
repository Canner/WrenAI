import { useCallback, useMemo } from 'react';
import { message } from 'antd';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState, {
  type RuntimeSelectorState,
} from '@/hooks/useRuntimeSelectorState';
import useSkillsControlPlaneData from '@/hooks/useSkillsControlPlaneData';
import { Path } from '@/utils/enum';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import useSkillConnectors from './useSkillConnectors';
import { buildSkillConnectorOptions } from './skillsPageUtils';

export default function useSkillsPageData() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState as Pick<
    RuntimeSelectorState,
    | 'currentWorkspace'
    | 'currentKnowledgeBase'
    | 'currentKbSnapshot'
    | 'kbSnapshots'
  > | null;

  const handleControlPlaneLoadError = useCallback((error: Error) => {
    const errorMessage = resolveAbortSafeErrorMessage(
      error,
      '加载技能失败，请稍后重试。',
    );
    if (errorMessage) {
      message.error(errorMessage);
    }
  }, []);

  const { data, loading, refetch } = useSkillsControlPlaneData({
    enabled: runtimeScopePage.hasRuntimeScope,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    onError: handleControlPlaneLoadError,
  });

  const { connectors, loading: connectorsLoading } = useSkillConnectors({
    enabled: runtimeScopePage.hasRuntimeScope,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    onError: () => {
      message.error('加载技能所需连接器失败。');
    },
  });

  const connectorOptions = useMemo(
    () => buildSkillConnectorOptions(connectors),
    [connectors],
  );
  const connectorsHref = useMemo(
    () => runtimeScopeNavigation.hrefWorkspace(Path.SettingsConnectors),
    [runtimeScopeNavigation],
  );
  const marketplaceCatalogSkills = data.marketplaceCatalogSkills;
  const skillDefinitions = data.skillDefinitions;
  const installedCatalogIds = useMemo(
    () =>
      new Set(
        skillDefinitions
          .map((definition) => definition.catalogId || null)
          .filter((catalogId): catalogId is string => Boolean(catalogId)),
      ),
    [skillDefinitions],
  );
  const enabledSkillCount = useMemo(
    () => skillDefinitions.filter((skill) => skill.isEnabled !== false).length,
    [skillDefinitions],
  );
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
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
  };
}
