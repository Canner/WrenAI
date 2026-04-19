import { Space, Tag, Typography } from 'antd';
import {
  sourceDetailColor,
  type WorkspaceGovernanceSourceDetail,
} from '@/features/settings/workspaceGovernanceShared';

const { Text } = Typography;

export const renderSourceDetails = (
  sourceDetails?: WorkspaceGovernanceSourceDetail[],
  fallback?: string,
) => {
  if (!sourceDetails || sourceDetails.length === 0) {
    return <Text type="secondary">{fallback || '—'}</Text>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {sourceDetails.map((detail, index) => (
        <Tag
          key={`${detail.kind || 'source'}-${index}`}
          color={sourceDetailColor(detail.kind)}
        >
          {detail.label || fallback || '—'}
        </Tag>
      ))}
    </Space>
  );
};
