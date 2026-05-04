import { useState, useMemo } from 'react';
import clsx from 'clsx';
import styled from 'styled-components';
import { Space, Button, Row, Col } from 'antd';
import ColumnHeightOutlined from '@ant-design/icons/ColumnHeightOutlined';
import MinusOutlined from '@ant-design/icons/MinusOutlined';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import { Logo } from '@/components/Logo';
import { makeIterable } from '@/utils/iteration';
import { GroupedQuestion } from '@/hooks/useRecommendedQuestionsInstruction';

const CategorySectionBlock = styled.div`
  background: var(--gray-1);
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  padding: 16px;
`;

const QuestionBlock = styled.div`
  background: var(--gray-1);
  user-select: none;
  height: 150px;
  transition: border-color ease 0.2s;

  &:hover:not(.is-disabled) {
    border-color: var(--geekblue-6) !important;
  }

  &.is-active {
    border-color: var(--geekblue-6) !important;
  }

  &.is-disabled {
    opacity: 0.8;
  }
`;

const MAX_EXPANDED_QUESTIONS = 9;

interface Props {
  onSelect: (payload: { sql: string; question: string }) => void;
  recommendedQuestions: GroupedQuestion[];
  loading: boolean;
}

const QuestionTemplate = ({
  category,
  sql,
  question,
  onSelect,
  loading,
  selectedQuestion,
}) => {
  const isSelected = selectedQuestion === question;
  const isDisabled = loading && !isSelected;

  const onClick = () => {
    if (loading) return;
    onSelect({ sql, question });
  };

  return (
    <Col span={8}>
      <QuestionBlock
        className={clsx(
          'border border-gray-5 rounded px-3 pt-3 pb-4',
          loading ? 'cursor-wait' : 'cursor-pointer',
          {
            'is-active': isSelected,
            'is-disabled cursor-not-allowed': isDisabled,
          },
        )}
        onClick={onClick}
      >
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div
            className="border border-gray-5 px-2 rounded-pill text-truncate"
            title={category}
          >
            {category}
          </div>
          {isSelected && loading && <LoadingOutlined className="ml-1 gray-7" />}
        </div>
        <EllipsisWrapper multipleLine={4} text={question} />
      </QuestionBlock>
    </Col>
  );
};

const QuestionColumnIterator = makeIterable(QuestionTemplate);

export default function RecommendedQuestionsPrompt(props: Props) {
  const { onSelect, recommendedQuestions, loading } = props;

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');

  const questionList = useMemo(() => {
    return recommendedQuestions.slice(
      0,
      isExpanded ? undefined : MAX_EXPANDED_QUESTIONS,
    );
  }, [recommendedQuestions, isExpanded]);

  const onHandleToggle = () => setIsExpanded((prev) => !prev);

  const showExpandButton = recommendedQuestions.length > MAX_EXPANDED_QUESTIONS;

  const onSelectQuestion = (payload: { sql: string; question: string }) => {
    onSelect(payload);
    setSelectedQuestion(payload.question);
  };

  return (
    <div className="bg-gray-2 px-10 py-6">
      <div className="d-flex align-center mb-3">
        <Logo size={24} color="var(--gray-8)" />
        <div className="text-md text-medium gray-8 mx-3">
          Know more about your data.
        </div>
        <div className="text-medium gray-7">
          Try asking some of the following questions
        </div>
      </div>
      <Space
        style={{ width: 680 }}
        className="gray-8"
        direction="vertical"
        size={[0, 16]}
      >
        <CategorySectionBlock>
          <Row gutter={[16, 16]} className="mt-3">
            <QuestionColumnIterator
              data={questionList}
              onSelect={onSelectQuestion}
              loading={loading}
              selectedQuestion={selectedQuestion}
            />
          </Row>
          {showExpandButton && (
            <div className="text-right">
              <Button
                onClick={() => onHandleToggle()}
                className="gray-6 mt-3"
                type="text"
                size="small"
                icon={isExpanded ? <MinusOutlined /> : <ColumnHeightOutlined />}
              >
                {isExpanded ? 'Collapse' : 'Expand all'}
              </Button>
            </div>
          )}
        </CategorySectionBlock>
      </Space>
    </div>
  );
}
