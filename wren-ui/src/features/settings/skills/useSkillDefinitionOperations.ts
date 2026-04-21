import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  deleteSkillDefinitionRecord,
  installSkillMarketplaceCatalog,
  type SkillDefinitionView,
  updateSkillDefinitionRecord,
} from '@/utils/skillsRest';

export default function useSkillDefinitionOperations({
  canCreateSkill,
  canUpdateSkill,
  canDeleteSkill,
  runtimeScopeSelector,
  refresh,
}: {
  canCreateSkill: boolean;
  canUpdateSkill: boolean;
  canDeleteSkill: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  refresh: () => Promise<void>;
}) {
  const [installingCatalogId, setInstallingCatalogId] = useState<string | null>(
    null,
  );
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);

  const handleInstallSkill = useCallback(
    async (catalogId: string) => {
      if (!canCreateSkill) {
        message.info('当前账号没有安装技能权限');
        return;
      }
      try {
        setInstallingCatalogId(catalogId);
        await installSkillMarketplaceCatalog(runtimeScopeSelector, catalogId);
        message.success('技能已安装。');
        await refresh();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '安装技能失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setInstallingCatalogId(null);
      }
    },
    [canCreateSkill, refresh, runtimeScopeSelector],
  );

  const handleToggleSkill = useCallback(
    async (skill: SkillDefinitionView) => {
      if (!canUpdateSkill) {
        message.info('当前账号没有变更技能状态的权限');
        return;
      }
      try {
        setTogglingSkillId(skill.id);
        await updateSkillDefinitionRecord(runtimeScopeSelector, skill.id, {
          isEnabled: !(skill.isEnabled !== false),
        });
        message.success(
          skill.isEnabled !== false ? '技能已停用。' : '技能已启用。',
        );
        await refresh();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '切换技能状态失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setTogglingSkillId(null);
      }
    },
    [canUpdateSkill, refresh, runtimeScopeSelector],
  );

  const handleDeleteSkill = useCallback(
    async (skillId: string) => {
      if (!canDeleteSkill) {
        message.info('当前账号没有删除技能权限');
        return;
      }
      try {
        setDeletingSkillId(skillId);
        await deleteSkillDefinitionRecord(runtimeScopeSelector, skillId);
        message.success('技能已删除。');
        await refresh();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除技能失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setDeletingSkillId(null);
      }
    },
    [canDeleteSkill, refresh, runtimeScopeSelector],
  );

  return {
    installingCatalogId,
    togglingSkillId,
    deletingSkillId,
    handleInstallSkill,
    handleToggleSkill,
    handleDeleteSkill,
  };
}
