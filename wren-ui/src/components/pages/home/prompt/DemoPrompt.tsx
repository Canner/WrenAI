import { Row, Col } from 'antd';
import { makeIterable } from '@/utils/iteration';
import EllipsisWrapper from '@/components/EllipsisWrapper';

interface Props {
  demo: any[];
  onSelect: (data: any) => void;
}

const BlockTemplate = ({ title, summary, onSelect }) => {
  return (
    <Col span={8}>
      <div
        className="border border-gray-5 rounded px-3 pt-3 pb-4 cursor-pointer"
        onClick={() => onSelect({ title, summary })}
      >
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div className="border border-gray-5 px-2 rounded-pill">{title}</div>
        </div>
        <EllipsisWrapper multipleLine={3} text={summary} />
      </div>
    </Col>
  );
};

export default function DemoPrompt(props: Props) {
  const { demo, onSelect } = props;
  const DemoColumns = makeIterable(BlockTemplate);
  return (
    <div style={{ width: 580 }}>
      <div className="text-center mt-3 mb-2">Try asking</div>
      <Row gutter={16}>
        <DemoColumns data={demo} onSelect={onSelect} />
      </Row>
    </div>
  );
}
