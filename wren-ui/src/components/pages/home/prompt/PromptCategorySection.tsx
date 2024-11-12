import styled from 'styled-components';
import { Button, Row, Col } from 'antd';
import ColumnHeightOutlined from '@ant-design/icons/ColumnHeightOutlined';
import MinusOutlined from '@ant-design/icons/MinusOutlined';
import EllipsisWrapper from '@/components/EllipsisWrapper';

const CategorySectionBlock = styled.div`
  position: relative;
  background: var(--gray-1);
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  padding: 16px;
`;

const QuestionBlock = styled.div`
  user-select: none;

  &:hover {
    border-color: var(--geekblue-6) !important;
    transition: border-color ease 0.2s;
  }
`;

const QuestionsCol = ({ label, question, onSelect }) => {
  return (
    <Col span={8}>
      <QuestionBlock
        className="bg-gray-2 border border-gray-3 rounded p-3 cursor-pointer"
        style={{ height: '100%' }}
        onClick={() => onSelect({ label, question })}
      >
        <EllipsisWrapper multipleLine={4} text={question} />
      </QuestionBlock>
    </Col>
  );
};

export default function PromptCategorySection({
  category,
  expandedCategory,
  onSelect,
  onHandleToggle,
}) {
  const isExpanded = expandedCategory === category.label;
  const showExpandButton =
    category.questions.length > 3 || (expandedCategory !== null && !isExpanded);

  return (
    <CategorySectionBlock>
      <div className="text-medium gray-7">{category.label}</div>
      {(expandedCategory === null || isExpanded) && (
        <Row gutter={[16, 16]} className="mt-3">
          {category.questions
            .slice(0, isExpanded ? category.questions.length : 3)
            .map((question, index) => (
              <QuestionsCol
                key={`${category.label}-${question}-${index}`}
                label={category.label}
                question={question}
                onSelect={onSelect}
              />
            ))}
        </Row>
      )}
      {showExpandButton && (
        <div className="text-right">
          <Button
            onClick={() => onHandleToggle(category.label)}
            className="gray-6 mr-2 mt-2"
            type="text"
            size="small"
            icon={isExpanded ? <MinusOutlined /> : <ColumnHeightOutlined />}
            style={
              expandedCategory && !isExpanded
                ? {
                    position: 'absolute',
                    right: 16,
                    top: 8,
                  }
                : {}
            }
          >
            {isExpanded ? 'Collapse' : 'Expand all'}
          </Button>
        </div>
      )}
    </CategorySectionBlock>
  );
}
