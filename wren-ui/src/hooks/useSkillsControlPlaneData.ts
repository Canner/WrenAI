import { useCallback, useEffect, useState } from 'react';
import { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { abortWithReason, isAbortRequestError } from '@/utils/abort';
import {
  listSkillDefinitions,
  listSkillMarketplaceCatalog,
  type SkillDefinitionView,
  type SkillMarketplaceCatalogView,
} from '@/utils/skillsRest';

export type SkillsControlPlaneData = {
  marketplaceCatalogSkills: SkillMarketplaceCatalogView[];
  skillDefinitions: SkillDefinitionView[];
};

const EMPTY_SKILLS_CONTROL_PLANE_DATA: SkillsControlPlaneData = {
  marketplaceCatalogSkills: [],
  skillDefinitions: [],
};

export default function useSkillsControlPlaneData({
  enabled,
  runtimeScopeSelector,
  onError,
}: {
  enabled: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) {
  const [data, setData] = useState<SkillsControlPlaneData>(
    EMPTY_SKILLS_CONTROL_PLANE_DATA,
  );
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(
    async (init?: RequestInit) => {
      if (!enabled) {
        setData(EMPTY_SKILLS_CONTROL_PLANE_DATA);
        setLoading(false);
        return EMPTY_SKILLS_CONTROL_PLANE_DATA;
      }

      setLoading(true);

      try {
        const [skillDefinitions, marketplaceCatalogSkills] = await Promise.all([
          listSkillDefinitions(runtimeScopeSelector, init),
          listSkillMarketplaceCatalog(runtimeScopeSelector, init),
        ]);

        const nextData = {
          marketplaceCatalogSkills,
          skillDefinitions,
        };

        if (!init?.signal || !init.signal.aborted) {
          setData(nextData);
        }

        return nextData;
      } catch (error) {
        if (init?.signal?.aborted || isAbortRequestError(error)) {
          return EMPTY_SKILLS_CONTROL_PLANE_DATA;
        }

        onError?.(
          error instanceof Error
            ? error
            : new Error('加载技能控制面失败，请稍后重试。'),
        );
        return EMPTY_SKILLS_CONTROL_PLANE_DATA;
      } finally {
        if (!init?.signal || !init.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [enabled, onError, runtimeScopeSelector],
  );

  useEffect(() => {
    if (!enabled) {
      setData(EMPTY_SKILLS_CONTROL_PLANE_DATA);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadData({ signal: controller.signal });

    return () => {
      abortWithReason(controller, 'skills-control-plane-request-cancelled');
    };
  }, [enabled, loadData]);

  const refetch = useCallback(async () => await loadData(), [loadData]);

  return {
    data,
    loading,
    refetch,
  };
}
