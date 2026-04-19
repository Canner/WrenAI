import { useCallback, useState } from 'react';
import { Form, message } from 'antd';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  createSkillDefinitionRecord,
  type SkillDefinitionView,
  updateSkillDefinitionRecord,
} from '@/utils/skillsRest';
import {
  buildSkillDefinitionSubmitPayload,
  stringifyJson,
  stringifyStringArray,
  type SkillDefinitionFormValues,
} from './skillsPageUtils';

export default function useSkillDefinitionModal({
  canCreateSkill,
  canUpdateSkill,
  runtimeScopeSelector,
  refresh,
}: {
  canCreateSkill: boolean;
  canUpdateSkill: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  refresh: () => Promise<void>;
}) {
  const [definitionForm] = Form.useForm<SkillDefinitionFormValues>();
  const [editingDefinition, setEditingDefinition] =
    useState<SkillDefinitionView | null>(null);
  const [definitionModalOpen, setDefinitionModalOpen] = useState(false);
  const [clearDefinitionSecretChecked, setClearDefinitionSecretChecked] =
    useState(false);
  const [definitionSubmitting, setDefinitionSubmitting] = useState(false);

  const openCreateDefinitionModal = useCallback(() => {
    if (!canCreateSkill) {
      message.info('当前账号没有创建技能权限');
      return;
    }
    setEditingDefinition(null);
    setClearDefinitionSecretChecked(false);
    definitionForm.resetFields();
    definitionForm.setFieldsValue({
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      executionMode: 'inject_only',
      enabled: true,
      secretText: '',
      instruction: '',
      kbSuggestionIdsText: '',
      runtimeConfigText: '',
    });
    setDefinitionModalOpen(true);
  }, [canCreateSkill, definitionForm]);

  const openEditDefinitionModal = useCallback(
    (definition: SkillDefinitionView) => {
      if (!canUpdateSkill) {
        message.info('当前账号没有编辑技能权限');
        return;
      }
      setEditingDefinition(definition);
      setClearDefinitionSecretChecked(false);
      definitionForm.setFieldsValue({
        name: definition.name,
        runtimeKind: definition.runtimeKind,
        sourceType: definition.sourceType,
        sourceRef: definition.sourceRef || undefined,
        entrypoint: definition.entrypoint || undefined,
        manifestText: stringifyJson(definition.manifest),
        secretText: '',
        instruction: definition.instruction || '',
        executionMode: definition.executionMode || 'inject_only',
        connectorId: definition.connectorId || undefined,
        enabled: definition.isEnabled !== false,
        kbSuggestionIdsText: stringifyStringArray(definition.kbSuggestionIds),
        runtimeConfigText: stringifyJson(definition.runtimeConfig),
      });
      setDefinitionModalOpen(true);
    },
    [canUpdateSkill, definitionForm],
  );

  const closeDefinitionModal = useCallback(() => {
    setDefinitionModalOpen(false);
    setEditingDefinition(null);
    setClearDefinitionSecretChecked(false);
    definitionForm.resetFields();
  }, [definitionForm]);

  const submitDefinition = useCallback(async () => {
    const hasPermission = editingDefinition ? canUpdateSkill : canCreateSkill;
    if (!hasPermission) {
      message.info(
        editingDefinition
          ? '当前账号没有编辑技能权限'
          : '当前账号没有创建技能权限',
      );
      return;
    }
    try {
      setDefinitionSubmitting(true);
      const values = await definitionForm.validateFields();
      const payload = buildSkillDefinitionSubmitPayload({
        values,
        editing: Boolean(editingDefinition),
        clearSecret: clearDefinitionSecretChecked,
      });

      if (editingDefinition) {
        await updateSkillDefinitionRecord(
          runtimeScopeSelector,
          editingDefinition.id,
          payload,
        );
        message.success('技能已更新。');
      } else {
        await createSkillDefinitionRecord(runtimeScopeSelector, payload);
        message.success('技能已创建。');
      }

      closeDefinitionModal();
      await refresh();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存技能失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setDefinitionSubmitting(false);
    }
  }, [
    canCreateSkill,
    canUpdateSkill,
    clearDefinitionSecretChecked,
    closeDefinitionModal,
    definitionForm,
    editingDefinition,
    refresh,
    runtimeScopeSelector,
  ]);

  return {
    definitionForm,
    editingDefinition,
    definitionModalOpen,
    clearDefinitionSecretChecked,
    definitionSubmitting,
    setClearDefinitionSecretChecked,
    openCreateDefinitionModal,
    openEditDefinitionModal,
    closeDefinitionModal,
    submitDefinition,
  };
}
