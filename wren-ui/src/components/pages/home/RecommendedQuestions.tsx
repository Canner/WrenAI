import clsx from 'clsx';
import styled from 'styled-components';
import { useMemo } from 'react';
import { Skeleton } from 'antd';
import BulbOutlined from '@ant-design/icons/BulbOutlined';
import { makeIterable } from '@/utils/iteration';
import {
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/apollo/client/graphql/__types__';

export interface SelectQuestionProps {
  question: string;
  sql: string;
}

interface Props {
  items: { question: string; sql: string }[];
  loading?: boolean;
  error?: {
    shortMessage?: string;
    code?: string;
    message?: string;
    stacktrace?: string[];
  };
  className?: string;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}

const StyledSkeleton = styled(Skeleton)`
  padding: 4px 0;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
    li {
      height: 14px;
      + li {
        margin-top: 12px;
      }
    }
  }
`;

export const getRecommendedQuestionProps = (
  data: RecommendedQuestionsTask,
  show = true,
) => {
  if (!data || !show) return { show: false };
  const questions = (data?.questions || []).slice(0, 3).map((item) => ({
    question: item.question,
    sql: item.sql,
  }));
  const loading = data?.status === RecommendedQuestionsTaskStatus.GENERATING;
  return {
    show: loading || questions.length > 0,
    state: {
      items: questions,
      loading,
      error: data?.error,
    },
  };
};

const QuestionItem = (props: {
  index: number;
  question: string;
  sql: string;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}) => {
  const { index, question, sql, onSelect } = props;
  return (
    <div className={clsx(index > 0 && 'mt-1')}>
      <span
        className="cursor-pointer hover:text"
        onClick={() => onSelect({ question, sql })}
      >
        {question}
      </span>
    </div>
  );
};
const QuestionList = makeIterable(QuestionItem);

export default function RecommendedQuestions(props: Props) {
  const { items, loading, className, onSelect } = props;

  const data = useMemo(
    () => items.map(({ question, sql }) => ({ question, sql })),
    [items],
  );

  return (
    <div className={clsx('bg-gray-2 rounded p-3', className)}>
      <div className="mb-2">
        <BulbOutlined className="mr-1 gray-6" />
        <b className="text-semi-bold text-sm gray-7">Recommended questions</b>
      </div>
      <div className="pl-1 gray-8">
        <StyledSkeleton
          active
          loading={loading}
          paragraph={{ rows: 3 }}
          title={false}
        >
          <QuestionList data={data} onSelect={onSelect} />
        </StyledSkeleton>
      </div>
    </div>
  );
}
