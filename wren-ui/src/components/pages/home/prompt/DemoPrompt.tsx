import { Row, Col } from 'antd';
import styled from 'styled-components';
import { makeIterable } from '@/utils/iteration';
import EllipsisWrapper from '@/components/EllipsisWrapper';

const DemoBlock = styled.div`
  user-select: none;
  height: 150px;
  &:hover {
    border-color: var(--geekblue-6) !important;
    transition: border-color ease 0.2s;
  }
`;

interface Props {
  demo: any[];
  onSelect: (data: { label: string; question: string }) => void;
}

const DemoTemplate = ({ label, question, onSelect }) => {
  return (
    <Col span={8}>
      <DemoBlock
        className="border border-gray-5 rounded px-3 pt-3 pb-4 cursor-pointer"
        onClick={() => onSelect({ label, question })}
      >
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div className="border border-gray-5 px-2 rounded-pill">{label}</div>
        </div>
        <EllipsisWrapper multipleLine={4} text={question} />
      </DemoBlock>
    </Col>
  );
};

const DemoColumnIterator = makeIterable(DemoTemplate);

export default function DemoPrompt(props: Props) {
  const { demo, onSelect } = props;
  return (
    <div className="gray-8" style={{ width: 580 }}>
      <div className="text-center mt-3 mb-2">Try asking...</div>
      <Row gutter={16}>
        <DemoColumnIterator data={demo} onSelect={onSelect} />
      </Row>
    </div>
  );
}
