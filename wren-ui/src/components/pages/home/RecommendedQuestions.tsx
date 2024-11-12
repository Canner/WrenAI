import clsx from 'clsx';
import styled from 'styled-components';
import { useMemo } from 'react';
import { Skeleton } from 'antd';
import BulbOutlined from '@ant-design/icons/BulbOutlined';
import { makeIterable } from '@/utils/iteration';

interface Props {
  items: string[];
  loading?: boolean;
  error?: {
    shortMessage?: string;
    code?: string;
    message?: string;
    stacktrace?: string[];
  };
  className?: string;
  onSelect?: (question: string) => void;
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

const QuestionItem = (props: {
  index: number;
  question: string;
  onSelect?: (question: string) => void;
}) => {
  const { index, question, onSelect } = props;
  return (
    <div className={clsx(index > 0 && 'mt-1')}>
      <span
        className="cursor-pointer hover:text"
        onClick={() => onSelect(question)}
      >
        {question}
      </span>
    </div>
  );
};
const QuestionList = makeIterable(QuestionItem);

export default function RecommendedQuestions(props: Props) {
  const { items, loading, className, onSelect } = props;

  const data = useMemo(() => items.map((question) => ({ question })), [items]);

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
