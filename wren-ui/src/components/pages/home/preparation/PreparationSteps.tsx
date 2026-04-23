import { Typography, Timeline, Badge, Tag } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import type { Props } from './index';
import type {
  PreparationTimelineModel,
  PreparationTimelineStepStatus,
} from './preparationTimelineModel';

const StyledBadge = styled(Badge)`
  position: absolute;
  top: -5px;
  left: -3px;
  .ant-badge-status-dot {
    width: 7px;
    height: 7px;
  }
  .ant-badge-status-text {
    display: none;
  }
`;

const StyledTimeline = styled(Timeline)`
  && {
    margin-bottom: 0;
  }

  .ant-timeline-item {
    padding-bottom: 10px;
  }

  .ant-timeline-item-last {
    padding-bottom: 2px;
  }

  .ant-timeline-item-head {
    background: transparent;
  }
`;

const StepTitle = styled(Typography.Text)`
  && {
    color: #273142;
    font-size: 12.5px;
    font-weight: 600;
  }
`;

const StepDescription = styled.div`
  margin-top: 3px;
  color: #667085;
  font-size: 12px;
  line-height: 1.6;
`;

const StepMarkdown = styled.div`
  margin-top: 6px;
  max-height: 160px;
  overflow-y: auto;
  color: #475467;
  font-size: 12px;
`;

const StepTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
`;

const getProcessDot = (processing: boolean) =>
  processing ? <StyledBadge color="geekblue" status="processing" /> : null;

export default function PreparationSteps(
  props: Props & { preparationModel: PreparationTimelineModel },
) {
  const { className, preparationModel } = props;

  const getDot = (status: PreparationTimelineStepStatus) => {
    if (status === 'running') {
      return getProcessDot(true);
    }

    if (status === 'finished') {
      return <CheckCircleFilled style={{ color: '#52c41a' }} />;
    }

    if (status === 'failed') {
      return <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
    }

    return undefined;
  };

  return (
    <StyledTimeline
      className={className}
      items={preparationModel.steps.map((step) => ({
        key: step.key,
        icon: getDot(step.status),
        content: (
          <>
            <StepTitle>{step.title}</StepTitle>
            {step.description ? (
              <StepDescription>{step.description}</StepDescription>
            ) : null}
            {step.tags?.length ? (
              <StepTags>
                {step.tags.map((tag) => (
                  <Tag key={`${step.key}-${tag}`} className="gray-7 mb-0">
                    {tag}
                  </Tag>
                ))}
              </StepTags>
            ) : null}
            {step.detailMarkdown ? (
              <StepMarkdown>
                <MarkdownBlock content={step.detailMarkdown} />
              </StepMarkdown>
            ) : null}
          </>
        ),
      }))}
    />
  );
}
