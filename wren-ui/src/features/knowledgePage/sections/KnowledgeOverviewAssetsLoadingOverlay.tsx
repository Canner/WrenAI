import { Typography } from 'antd';
import {
  AssetsLoadingCard,
  AssetsLoadingGrid,
  AssetsLoadingIntro,
  AssetsLoadingLine,
  AssetsLoadingOverlay,
  AssetsLoadingStage,
} from '@/features/knowledgePage/index.styles';

const { Text } = Typography;

export default function KnowledgeOverviewAssetsLoadingOverlay() {
  return (
    <AssetsLoadingOverlay>
      <AssetsLoadingStage>
        <AssetsLoadingIntro>
          <Text strong style={{ color: '#111827' }}>
            正在同步知识库内容…
          </Text>
          <Text type="secondary">
            当前知识库的表结构与字段信息正在加载，稍后会自动展示。
          </Text>
        </AssetsLoadingIntro>
        <AssetsLoadingGrid>
          {[0, 1].map((index) => (
            <AssetsLoadingCard key={index}>
              <AssetsLoadingLine $width="46%" $height={14} />
              <AssetsLoadingLine $width="78%" $muted />
              <AssetsLoadingLine $width="100%" $muted />
              <AssetsLoadingLine $width="68%" $muted />
              <AssetsLoadingLine $width="22%" $height={18} />
            </AssetsLoadingCard>
          ))}
        </AssetsLoadingGrid>
      </AssetsLoadingStage>
    </AssetsLoadingOverlay>
  );
}
