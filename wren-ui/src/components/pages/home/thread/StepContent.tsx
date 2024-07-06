import { useEffect } from 'react';
import { Button, ButtonProps, Col, Row, Typography } from 'antd';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { BinocularsIcon } from '@/utils/icons';
import CollapseContent, {
  Props as CollapseContentProps,
} from '@/components/pages/home/thread/CollapseContent';
import useAnswerStepContent from '@/hooks/useAnswerStepContent';
import { nextTick } from '@/utils/time';

const { Text, Paragraph } = Typography;

interface Props {
  fullSql: string;
  isLastStep: boolean;
  isLastThreadResponse: boolean;
  onTriggerScrollToBottom: () => void;
  sql: string;
  stepIndex: number;
  summary: string;
  threadResponseId: number;
}

export default function StepContent(props: Props) {
  const {
    fullSql,
    isLastStep,
    isLastThreadResponse,
    onTriggerScrollToBottom,
    sql,
    stepIndex,
    summary,
    threadResponseId,
  } = props;

  const {
    collapseContentProps,
    previewDataButtonProps,
    viewSQLButtonProps,
    viewSQLButtonText,
  } = useAnswerStepContent({
    fullSql,
    isLastStep,
    sql,
    threadResponseId,
    stepIndex,
  });

  const stepNumber = stepIndex + 1;

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    previewDataButtonProps.onClick();
    await nextTick(1500);
    onTriggerScrollToBottom();
  };

  // when is the last step of the last thread response, auto trigger preview data button
  useEffect(() => {
    if (isLastStep && isLastThreadResponse) {
      autoTriggerPreviewDataButton();
    }
  }, [isLastStep, isLastThreadResponse]);

  return (
    <Row
      className={`pb-3${!isLastStep ? ' mb-5 border-b border-gray-3' : ''}`}
      wrap={false}
    >
      <Col className="text-center" flex="28px">
        <div className="gray-8 text-extra-bold">{stepNumber}.</div>
      </Col>
      <Col flex="auto">
        <Paragraph>
          <Text>{summary}</Text>
        </Paragraph>
        <Button
          {...(previewDataButtonProps as ButtonProps)}
          size="small"
          icon={
            <BinocularsIcon
              style={{
                paddingBottom: 2,
                marginRight: 8,
              }}
            />
          }
          data-ph-capture="true"
          data-ph-capture-attribute-name="cta_answer_preview_data"
          data-ph-capture-attribute-step={stepNumber}
          data-ph-capture-attribute-is_last_step={isLastStep}
        >
          Preview Data
        </Button>
        <Button
          {...(viewSQLButtonProps as ButtonProps)}
          size="small"
          icon={<FunctionOutlined />}
          data-ph-capture="true"
          data-ph-capture-attribute-name="cta_answer_view_sql"
          data-ph-capture-attribute-step={stepNumber}
          data-ph-capture-attribute-is_last_step={isLastStep}
        >
          {viewSQLButtonText}
        </Button>
        <CollapseContent
          {...(collapseContentProps as Omit<
            CollapseContentProps,
            'attributes'
          >)}
          key={`collapse-${stepNumber}`}
          attributes={{ stepNumber, isLastStep }}
        />
      </Col>
    </Row>
  );
}
