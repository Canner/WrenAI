import { Skeleton, Space } from 'antd';
import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import { Stage } from '@/features/home/homePageStyles';

export default function HomeLandingPageLoadingState() {
  return (
    <DirectShellPageFrame activeNav="home">
      <Stage>
        <Space
          orientation="vertical"
          size={20}
          style={{ width: '100%', maxWidth: 720 }}
        >
          <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 5 }} />
          <Skeleton.Button
            active
            block
            style={{ height: 148, width: '100%' }}
          />
        </Space>
      </Stage>
    </DirectShellPageFrame>
  );
}
