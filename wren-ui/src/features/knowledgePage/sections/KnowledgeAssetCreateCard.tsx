import PlusOutlined from '@ant-design/icons/PlusOutlined';
import {
  WorkbenchCreateCard,
  WorkbenchCreateCardIcon,
  WorkbenchCreateCardMeta,
  WorkbenchCreateCardTitle,
  WorkbenchCreateCardTop,
} from '@/features/knowledgePage/index.styles';

type KnowledgeAssetCreateCardProps = {
  onOpenAssetWizard: () => void;
};

export default function KnowledgeAssetCreateCard({
  onOpenAssetWizard,
}: KnowledgeAssetCreateCardProps) {
  return (
    <WorkbenchCreateCard
      type="button"
      onClick={onOpenAssetWizard}
      data-testid="knowledge-add-asset-card"
    >
      <WorkbenchCreateCardTop>
        <WorkbenchCreateCardIcon>
          <PlusOutlined />
        </WorkbenchCreateCardIcon>
        <WorkbenchCreateCardTitle>添加资产</WorkbenchCreateCardTitle>
      </WorkbenchCreateCardTop>
      <WorkbenchCreateCardMeta>
        通过完整向导选择连接、预览字段并完成知识配置。
      </WorkbenchCreateCardMeta>
    </WorkbenchCreateCard>
  );
}
