import { Skeleton, Space } from 'antd';
import { LibraryStage } from '@/features/knowledgePage/index.styles';

export default function KnowledgeLoadingStage() {
  return (
    <LibraryStage>
      <Space
        direction="vertical"
        size={18}
        style={{ width: '100%', maxWidth: 960 }}
      >
        <Skeleton active title={{ width: '32%' }} paragraph={{ rows: 4 }} />
        <Skeleton active paragraph={{ rows: 8 }} />
      </Space>
    </LibraryStage>
  );
}
