import { useMemo } from 'react';
import { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  listSkillDefinitions,
  listSkillMarketplaceCatalog,
  type SkillDefinitionView,
  type SkillMarketplaceCatalogView,
} from '@/utils/skillsRest';
import useRestRequest from './useRestRequest';

export type SkillsControlPlaneData = {
  marketplaceCatalogSkills: SkillMarketplaceCatalogView[];
  skillDefinitions: SkillDefinitionView[];
};

const EMPTY_SKILLS_CONTROL_PLANE_DATA: SkillsControlPlaneData = {
  marketplaceCatalogSkills: [],
  skillDefinitions: [],
};

export const buildSkillsControlPlaneRequestKey = ({
  enabled,
  runtimeScopeSelector,
}: {
  enabled: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
}) =>
  enabled
    ? JSON.stringify({
        workspaceId: runtimeScopeSelector.workspaceId || null,
        knowledgeBaseId: runtimeScopeSelector.knowledgeBaseId || null,
        kbSnapshotId: runtimeScopeSelector.kbSnapshotId || null,
        deployHash: runtimeScopeSelector.deployHash || null,
        runtimeScopeId: runtimeScopeSelector.runtimeScopeId || null,
      })
    : null;

export default function useSkillsControlPlaneData({
  enabled,
  runtimeScopeSelector,
  onError,
}: {
  enabled: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) {
  const requestKey = useMemo(
    () =>
      buildSkillsControlPlaneRequestKey({
        enabled,
        runtimeScopeSelector,
      }),
    [
      enabled,
      runtimeScopeSelector.deployHash,
      runtimeScopeSelector.kbSnapshotId,
      runtimeScopeSelector.knowledgeBaseId,
      runtimeScopeSelector.runtimeScopeId,
      runtimeScopeSelector.workspaceId,
    ],
  );
  const { data, loading, refetch } = useRestRequest<SkillsControlPlaneData>({
    enabled,
    initialData: EMPTY_SKILLS_CONTROL_PLANE_DATA,
    requestKey,
    request: async ({ signal }) => {
      const [skillDefinitions, marketplaceCatalogSkills] = await Promise.all([
        listSkillDefinitions(runtimeScopeSelector, { signal }),
        listSkillMarketplaceCatalog(runtimeScopeSelector, { signal }),
      ]);

      return {
        marketplaceCatalogSkills,
        skillDefinitions,
      };
    },
    onError,
  });

  return {
    data,
    loading,
    refetch,
  };
}
