import { Typography } from 'antd';

import { WorkbenchEmpty } from '@/features/knowledgePage/index.styles';

const { Text } = Typography;

type KnowledgeWorkbenchEditorEmptyStateProps = {
  description: string;
  title: string;
};

export default function KnowledgeWorkbenchEditorEmptyState({
  description,
  title,
}: KnowledgeWorkbenchEditorEmptyStateProps) {
  return (
    <WorkbenchEmpty style={{ minHeight: 200 }}>
      <Text strong>{title}</Text>
      <Text type="secondary">{description}</Text>
    </WorkbenchEmpty>
  );
}
