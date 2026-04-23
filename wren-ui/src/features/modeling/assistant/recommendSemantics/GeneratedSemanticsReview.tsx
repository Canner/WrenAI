import { Card, Typography } from 'antd';
import type { SemanticsDescriptionModel } from '@/types/modelingAssistant';

const { Paragraph, Text } = Typography;

export default function GeneratedSemanticsReview({
  items,
}: {
  items: SemanticsDescriptionModel[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map((item) => (
        <Card key={item.name} style={{ borderRadius: 16 }}>
          <Text strong style={{ fontSize: 16 }}>
            {item.name}
          </Text>
          <Paragraph style={{ marginTop: 8, color: '#667085' }}>
            {item.description || '-'}
          </Paragraph>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {item.columns.map((column) => (
              <div
                key={`${item.name}-${column.name}`}
                style={{
                  paddingTop: 12,
                  borderTop: '1px solid rgba(229, 231, 235, 0.8)',
                }}
              >
                <Text strong>{column.name}</Text>
                <Paragraph style={{ margin: '4px 0 0', color: '#667085' }}>
                  {column.description || '-'}
                </Paragraph>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
