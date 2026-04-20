import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceRoleCatalogItem } from '@/features/settings/workspaceGovernanceShared';
import { buildCopiedWorkspaceRoleName } from './permissionsPageUtils';
import {
  EMPTY_ROLE_DRAFT,
  EMPTY_ROLE_ID,
  buildRolePayload,
  normalizePermissionNames,
  type EditorIntent,
  type RoleDraft,
} from './permissionsRoleCatalogMeta';
import type { WorkspaceRoleDraftPayload } from './usePermissionsCustomRoles';

type Params = {
  draft: RoleDraft;
  isCreateMode: boolean;
  isDirty: boolean;
  isSystemRole: boolean;
  onCreateCustomRole: (
    payload: WorkspaceRoleDraftPayload,
  ) => Promise<string | null> | string | null;
  onDeleteCustomRole: (roleId: string) => Promise<boolean> | boolean;
  onUpdateCustomRole: (
    roleId: string,
    payload: WorkspaceRoleDraftPayload,
  ) => Promise<boolean> | boolean;
  resetFilters: () => void;
  roleCatalog: WorkspaceRoleCatalogItem[];
  selectedRole: WorkspaceRoleCatalogItem | null;
  selectedRoleId: string | null;
  setDraft: Dispatch<SetStateAction<RoleDraft>>;
  setSelectedRoleId: Dispatch<SetStateAction<string | null>>;
};

export default function usePermissionsRoleCatalogActions({
  draft,
  isCreateMode,
  isDirty,
  isSystemRole,
  onCreateCustomRole,
  onDeleteCustomRole,
  onUpdateCustomRole,
  resetFilters,
  roleCatalog,
  selectedRole,
  selectedRoleId,
  setDraft,
  setSelectedRoleId,
}: Params) {
  const [pendingIntent, setPendingIntent] = useState<EditorIntent | null>(null);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);

  const handleSaveRole = async () => {
    const includeMetadata = isCreateMode || !isSystemRole;
    const payload = buildRolePayload({ draft, includeMetadata });
    if (isCreateMode) {
      if (!payload.name) {
        return false;
      }
      const createdRoleId = await onCreateCustomRole(payload);
      if (createdRoleId) {
        setSelectedRoleId(createdRoleId);
        return true;
      }
      return false;
    }

    if (!selectedRole) {
      return false;
    }

    return Boolean(await onUpdateCustomRole(selectedRole.id, payload));
  };

  const performIntent = async (intent: EditorIntent) => {
    if (intent.type === 'create') {
      setSelectedRoleId(EMPTY_ROLE_ID);
      setDraft(EMPTY_ROLE_DRAFT);
      resetFilters();
      return;
    }

    if (intent.type === 'select') {
      if (selectedRoleId === intent.roleId && !isCreateMode) {
        return;
      }
      setSelectedRoleId(intent.roleId);
      resetFilters();
      return;
    }

    const targetRole = roleCatalog.find((role) => role.id === intent.roleId);
    if (!targetRole) {
      return;
    }

    if (intent.type === 'copy') {
      setSelectedRoleId(EMPTY_ROLE_ID);
      setDraft({
        name: buildCopiedWorkspaceRoleName({
          sourceName: targetRole.name,
          existingNames: roleCatalog.map((role) => role.name),
        }),
        displayName: `${targetRole.displayName || targetRole.name} 副本`,
        description: targetRole.description || '',
        isActive: targetRole.isActive !== false,
        permissionNames: normalizePermissionNames(targetRole.permissionNames),
      });
      resetFilters();
      return;
    }

    if (intent.type === 'delete') {
      const deleted = await onDeleteCustomRole(targetRole.id);
      if (deleted && selectedRoleId === targetRole.id) {
        setSelectedRoleId(null);
      }
      return;
    }

    if (intent.type === 'toggleStatus') {
      await onUpdateCustomRole(targetRole.id, {
        name: targetRole.name,
        displayName: targetRole.displayName,
        description: targetRole.description || null,
        isActive: intent.nextActive,
        permissionNames: targetRole.permissionNames,
      });
    }
  };

  const requestIntent = (intent: EditorIntent) => {
    if (!isDirty) {
      void performIntent(intent);
      return;
    }
    setPendingIntent(intent);
    setUnsavedModalOpen(true);
  };

  const closeUnsavedModal = () => {
    setUnsavedModalOpen(false);
    setPendingIntent(null);
  };

  const handleDiscardAndContinue = () => {
    if (pendingIntent) {
      void performIntent(pendingIntent);
    }
    closeUnsavedModal();
  };

  const handleSaveAndContinue = async () => {
    const success = await handleSaveRole();
    if (!success) {
      return;
    }
    if (pendingIntent) {
      await performIntent(pendingIntent);
    }
    closeUnsavedModal();
  };

  return {
    closeUnsavedModal,
    handleDiscardAndContinue,
    handleSaveAndContinue,
    handleSaveRole,
    requestIntent,
    unsavedModalOpen,
  };
}
