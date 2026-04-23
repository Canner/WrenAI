import clsx from 'clsx';
import styled from 'styled-components';
import { useMemo } from 'react';
import { Skeleton } from 'antd';
import AppstoreOutlined from '@ant-design/icons/AppstoreOutlined';
import BarChartOutlined from '@ant-design/icons/BarChartOutlined';
import BulbOutlined from '@ant-design/icons/BulbOutlined';
import OrderedListOutlined from '@ant-design/icons/OrderedListOutlined';
import PieChartOutlined from '@ant-design/icons/PieChartOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import RiseOutlined from '@ant-design/icons/RiseOutlined';
import SwapOutlined from '@ant-design/icons/SwapOutlined';
import {
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/types/home';
import { captureUserTelemetryEvent } from '@/utils/telemetry';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';

export interface SelectQuestionProps {
  question: string;
  sql: string;
  category?: string | null;
  interactionMode?: 'draft_to_composer' | 'execute_intent' | null;
  sourceResponseId?: number | null;
  suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
}

interface Props {
  items: Array<{
    category?: string | null;
    interactionMode?: 'draft_to_composer' | 'execute_intent' | null;
    question: string;
    sourceResponseId?: number | null;
    sql: string;
    suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
  }>;
  loading?: boolean;
  error?: {
    shortMessage?: string | null;
    code?: string | null;
    message?: string | null;
    stacktrace?: (string | null)[] | null;
  } | null;
  className?: string;
  title?: string;
  onSelect: (payload: SelectQuestionProps) => void;
}

const StyledSkeleton = styled(Skeleton)`
  .ant-skeleton-paragraph {
    margin-bottom: 0;
    li {
      height: 16px;
      border-radius: 999px;
      + li {
        margin-top: 12px;
      }
    }
  }
`;

const RecommendedQuestionsShell = styled.div`
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(249, 250, 251, 0.92) 100%
  );
  padding: 14px;
`;

const RecommendedQuestionsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: #475467;
  font-size: 12px;
  font-weight: 600;
`;

const RecommendedQuestionsIntro = styled.p`
  margin: 0 0 10px;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
`;

const RecommendedQuestionsBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RecommendedQuestionRow = styled.button`
  width: 100%;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #344054;
  border-radius: 14px;
  min-height: 56px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: rgba(111, 71, 255, 0.22);
    box-shadow: 0 8px 18px rgba(111, 71, 255, 0.08);
    transform: translateY(-1px);
  }
`;

const RecommendationLeadingIcon = styled.span`
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(111, 71, 255, 0.08);
  color: var(--nova-primary-strong);
  flex: 0 0 auto;
`;

const RecommendationContent = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
`;

const RecommendationBadge = styled.span`
  width: fit-content;
  max-width: 100%;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: #667085;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
`;

const RecommendationQuestionText = styled.span`
  color: #344054;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
`;

const RecommendationArrow = styled.span`
  color: #98a2b3;
  flex: 0 0 auto;
`;

export type RecommendedQuestionRenderState =
  | { show: false }
  | {
      show: true;
      state: {
        items: Array<{
          category?: string | null;
          interactionMode?: 'draft_to_composer' | 'execute_intent' | null;
          question: string;
          sourceResponseId?: number | null;
          sql: string;
          suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
        }>;
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
    category: item.category,
    interactionMode: 'draft_to_composer' as const,
    question: item.question,
    sourceResponseId: null,
    sql: item.sql,
    suggestedIntent: 'ASK' as const,
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

const getRecommendationIcon = (category?: string | null) => {
  switch (category) {
    case 'compare':
      return <SwapOutlined />;
    case 'trend':
      return <RiseOutlined />;
    case 'distribution':
      return <PieChartOutlined />;
    case 'ranking':
      return <OrderedListOutlined />;
    case 'chart_followup':
    case 'chart_refine':
      return <BarChartOutlined />;
    case 'drill_down':
      return <AppstoreOutlined />;
    default:
      return <BulbOutlined />;
  }
};

const getRecommendationCategoryLabel = ({
  category,
  messages,
}: {
  category?: string | null;
  messages: ReturnType<typeof useThreadWorkbenchMessages>;
}) => {
  switch (category) {
    case 'drill_down':
      return messages.recommendation.categories.drillDown;
    case 'compare':
      return messages.recommendation.categories.compare;
    case 'trend':
      return messages.recommendation.categories.trend;
    case 'distribution':
      return messages.recommendation.categories.distribution;
    case 'ranking':
      return messages.recommendation.categories.ranking;
    case 'chart_followup':
      return messages.recommendation.categories.chartFollowUp;
    case 'chart_refine':
      return messages.recommendation.categories.chartRefine;
    default:
      return messages.recommendation.categories.relatedQuestion;
  }
};

const emitRecommendationSelectionTelemetry = ({
  interactionMode,
  question,
  sourceResponseId,
  suggestedIntent,
}: SelectQuestionProps) => {
  captureUserTelemetryEvent(
    interactionMode === 'execute_intent'
      ? 'home_recommendation_item_executed'
      : 'home_recommendation_item_drafted',
    {
      question,
      sourceResponseId: sourceResponseId ?? null,
      suggestedIntent: suggestedIntent ?? null,
    },
  );
};

export default function RecommendedQuestions(props: Props) {
  const messages = useThreadWorkbenchMessages();
  const { items, loading, className, onSelect, title } = props;

  const data = useMemo(() => items.map((item) => ({ ...item })), [items]);

  return (
    <RecommendedQuestionsShell className={clsx(className)}>
      <RecommendedQuestionsHeader>
        <BulbOutlined />
        <span>{title || messages.recommendation.sectionTitle}</span>
      </RecommendedQuestionsHeader>
      <RecommendedQuestionsIntro>
        {messages.recommendation.sectionIntro}
      </RecommendedQuestionsIntro>
      <RecommendedQuestionsBody>
        <StyledSkeleton
          active
          loading={loading}
          paragraph={{ rows: 3 }}
          title={false}
        >
          {data.map((item, index) => {
            const payload: SelectQuestionProps = {
              category: item.category,
              interactionMode: item.interactionMode,
              question: item.question,
              sourceResponseId: item.sourceResponseId,
              sql: item.sql,
              suggestedIntent: item.suggestedIntent,
            };

            return (
              <RecommendedQuestionRow
                key={`${item.question}-${index}`}
                type="button"
                aria-label={item.question}
                onClick={() => {
                  emitRecommendationSelectionTelemetry(payload);
                  onSelect(payload);
                }}
              >
                <RecommendationLeadingIcon aria-hidden="true">
                  {getRecommendationIcon(item.category)}
                </RecommendationLeadingIcon>
                <RecommendationContent>
                  <RecommendationBadge aria-hidden="true">
                    {getRecommendationCategoryLabel({
                      category: item.category,
                      messages,
                    })}
                  </RecommendationBadge>
                  <RecommendationQuestionText>
                    {item.question}
                  </RecommendationQuestionText>
                </RecommendationContent>
                <RecommendationArrow aria-hidden="true">
                  <RightOutlined />
                </RecommendationArrow>
              </RecommendedQuestionRow>
            );
          })}
        </StyledSkeleton>
      </RecommendedQuestionsBody>
    </RecommendedQuestionsShell>
  );
}
