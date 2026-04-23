import clsx from 'clsx';
import styled from 'styled-components';
import { useMemo } from 'react';
import { Skeleton } from 'antd';
import BulbOutlined from '@ant-design/icons/BulbOutlined';
import { makeIterable } from '@/utils/iteration';
import {
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/types/home';

export interface SelectQuestionProps {
  question: string;
  sql: string;
}

interface Props {
  items: { question: string; sql: string }[];
  loading?: boolean;
  error?: {
    shortMessage?: string | null;
    code?: string | null;
    message?: string | null;
    stacktrace?: (string | null)[] | null;
  } | null;
  className?: string;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}

const StyledSkeleton = styled(Skeleton)`
  padding: 2px 0;
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

const RecommendedQuestionsShell = styled.div`
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(249, 250, 251, 0.88) 100%
  );
  padding: 12px 14px;
`;

const RecommendedQuestionsHeader = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #475467;
  font-size: 12px;
  font-weight: 600;
`;

const RecommendedQuestionsBody = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const RecommendedQuestionChip = styled.button`
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  color: #344054;
  border-radius: 999px;
  min-height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: rgba(111, 71, 255, 0.22);
    color: var(--nova-primary-strong);
    box-shadow: 0 6px 14px rgba(111, 71, 255, 0.06);
    transform: translateY(-1px);
  }
`;

export type RecommendedQuestionRenderState =
  | { show: false }
  | {
      show: true;
      state: {
        items: { question: string; sql: string }[];
        loading: boolean;
        error?: RecommendedQuestionsTask['error'];
      };
    };

export const getRecommendedQuestionProps = (
  data?: RecommendedQuestionsTask | null,
  show = true,
): RecommendedQuestionRenderState => {
  if (!data || !show) return { show: false };
  const questions = (data?.questions || []).slice(0, 3).map((item) => ({
    question: item.question,
    sql: item.sql,
  }));
  const loading = data?.status === RecommendedQuestionsTaskStatus.GENERATING;

  if (!loading && questions.length === 0) {
    return { show: false };
  }

  return {
    show: true,
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
  const { question, sql, onSelect } = props;
  return (
    <RecommendedQuestionChip
      type="button"
      onClick={() => onSelect({ question, sql })}
    >
      {question}
    </RecommendedQuestionChip>
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
    <RecommendedQuestionsShell className={clsx(className)}>
      <RecommendedQuestionsHeader>
        <BulbOutlined />
        <span>推荐追问</span>
      </RecommendedQuestionsHeader>
      <RecommendedQuestionsBody>
        <StyledSkeleton
          active
          loading={loading}
          paragraph={{ rows: 3 }}
          title={false}
        >
          <QuestionList data={data} onSelect={onSelect} />
        </StyledSkeleton>
      </RecommendedQuestionsBody>
    </RecommendedQuestionsShell>
  );
}
