import { Typography } from 'antd';
import { FolderOpenOutlined, PlusOutlined } from '@ant-design/icons';
import {
  EmptyInner,
  EmptyStage,
  PrimaryBlackButton,
} from '@/features/knowledgePage/index.styles';

const { Text, Title } = Typography;

type KnowledgeOverviewAssetsEmptyStateProps = {
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  historicalSnapshotReadonlyHint: string;
  onOpenAssetWizard: () => void;
};

export default function KnowledgeOverviewAssetsEmptyState({
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  historicalSnapshotReadonlyHint,
  onOpenAssetWizard,
}: KnowledgeOverviewAssetsEmptyStateProps) {
  return (
    <EmptyStage>
      <EmptyInner>
        <FolderOpenOutlined style={{ fontSize: 48, color: '#c4c8d5' }} />
        <Title level={4} style={{ margin: 0 }}>
          知识库为空
        </Title>
        <Text type="secondary">
          {isReadonlyKnowledgeBase
            ? '系统样例已预置结构与问答配置，可直接浏览体验。'
            : isSnapshotReadonlyKnowledgeBase
              ? historicalSnapshotReadonlyHint
              : '先添加资产，后续这里会展示表、视图与字段概览。'}
        </Text>
        {!isKnowledgeMutationDisabled ? (
          <PrimaryBlackButton type="button" onClick={onOpenAssetWizard}>
            <PlusOutlined />
            <span>添加资产</span>
          </PrimaryBlackButton>
        ) : null}
      </EmptyInner>
    </EmptyStage>
  );
}
