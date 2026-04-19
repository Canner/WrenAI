import type { ComponentProps } from 'react';
import AssetWizardModal from '@/features/knowledgePage/modals/AssetWizardModal';
import KnowledgeBaseModal from '@/features/knowledgePage/modals/KnowledgeBaseModal';

type KnowledgeWorkbenchOverlaysProps = {
  knowledgeBaseModalProps?: ComponentProps<typeof KnowledgeBaseModal> | null;
  assetWizardModalProps?: ComponentProps<typeof AssetWizardModal> | null;
};

export default function KnowledgeWorkbenchOverlays({
  knowledgeBaseModalProps,
  assetWizardModalProps,
}: KnowledgeWorkbenchOverlaysProps) {
  return (
    <>
      {knowledgeBaseModalProps?.visible ? (
        <KnowledgeBaseModal {...knowledgeBaseModalProps} />
      ) : null}

      {assetWizardModalProps?.visible ? (
        <AssetWizardModal {...assetWizardModalProps} />
      ) : null}
    </>
  );
}
