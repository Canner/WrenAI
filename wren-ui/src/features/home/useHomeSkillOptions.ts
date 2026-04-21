import { useEffect, useRef, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import {
  fetchHomeSkillOptions,
  getCachedHomeSkillOptions,
  type HomeSkillOption,
  shouldLoadHomeSkillOptions,
} from '@/features/home/homeSkillOptions';

export default function useHomeSkillOptions({
  workspaceId,
  hasExecutableAskRuntime,
  skillPickerOpen,
  selectedSkillIds,
  setSelectedSkillIds,
}: {
  workspaceId?: string | null;
  hasExecutableAskRuntime: boolean;
  skillPickerOpen: boolean;
  selectedSkillIds: string[];
  setSelectedSkillIds: (skillIds: string[]) => void;
}) {
  const skillOptionsRequestRef = useRef<Promise<HomeSkillOption[]> | null>(
    null,
  );
  const skillOptionsRequestWorkspaceRef = useRef<string | null>(null);
  const [skillOptionSource, setSkillOptionSource] = useState<HomeSkillOption[]>(
    [],
  );
  const [skillOptionsLoading, setSkillOptionsLoading] = useState(false);
  const [skillOptionsError, setSkillOptionsError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const cachedSkillOptions = getCachedHomeSkillOptions(workspaceId);

    if (!workspaceId || !hasExecutableAskRuntime) {
      setSkillOptionSource([]);
      setSelectedSkillIds([]);
      setSkillOptionsLoading(false);
      setSkillOptionsError(null);
      return () => {
        cancelled = true;
      };
    }

    if (cachedSkillOptions) {
      setSkillOptionSource(cachedSkillOptions);
      setSkillOptionsError(null);
    }

    if (
      !shouldLoadHomeSkillOptions({
        workspaceId,
        hasExecutableRuntime: hasExecutableAskRuntime,
        skillPickerOpen,
        selectedSkillCount: selectedSkillIds.length,
      })
    ) {
      setSkillOptionsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (cachedSkillOptions) {
      return () => {
        cancelled = true;
      };
    }

    const loadSkillOptions = async () => {
      setSkillOptionsLoading(true);
      setSkillOptionsError(null);
      let request: Promise<HomeSkillOption[]> | null = null;

      try {
        request =
          skillOptionsRequestWorkspaceRef.current === workspaceId
            ? skillOptionsRequestRef.current
            : null;
        if (!request) {
          request = fetchHomeSkillOptions(workspaceId);
          skillOptionsRequestRef.current = request;
          skillOptionsRequestWorkspaceRef.current = workspaceId;
        }
        skillOptionsRequestRef.current = request;
        const skills = await request;

        if (cancelled) {
          return;
        }

        setSkillOptionSource(skills);
      } catch (_error) {
        if (!cancelled) {
          setSkillOptionSource([]);
          setSkillOptionsError('加载技能列表失败，请稍后重试。');
          message.error('加载技能列表失败，请稍后重试。');
        }
      } finally {
        if (skillOptionsRequestRef.current === request) {
          skillOptionsRequestRef.current = null;
          skillOptionsRequestWorkspaceRef.current = null;
        }
        if (!cancelled) {
          setSkillOptionsLoading(false);
        }
      }
    };

    void loadSkillOptions();

    return () => {
      cancelled = true;
    };
  }, [
    hasExecutableAskRuntime,
    selectedSkillIds.length,
    setSelectedSkillIds,
    skillPickerOpen,
    workspaceId,
  ]);

  return {
    skillOptionSource,
    skillOptionsError,
    skillOptionsLoading,
  };
}
