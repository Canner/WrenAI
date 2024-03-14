import { Button, Skeleton, Typography } from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import StepContent from '@/components/pages/home/StepContent';

const { Title } = Typography;

interface Props {
  loading: boolean;
  onOpenSaveAsViewModal: (data: { sql: string }) => void;
  question: string;
  description: string;
  answerResultSteps: Array<{
    summary: string;
    sql: string;
  }>;
  sql: string;
}

export default function AnswerResult(props: Props) {
  const {
    loading,
    onOpenSaveAsViewModal,
    question,
    description,
    answerResultSteps,
    sql,
  } = props;

  return (
    <Skeleton active loading={loading}>
      <Typography>
        <Title level={4}>
          <QuestionCircleOutlined className="mr-2" />
          {question}
        </Title>
        <Title level={4}>
          <CheckCircleOutlined className="mr-2" />
          Answer
        </Title>
        <Title level={5} style={{ fontWeight: 400 }}>
          {description}
        </Title>
        {answerResultSteps.map((step, index) => (
          <StepContent
            isLastStep={index === answerResultSteps.length - 1}
            key={`${step.summary}-${index}`}
            sql={step.sql}
            fullSql={sql}
            stepNumber={index + 1}
            summary={step.summary}
          />
        ))}
        <Button
          className="mt-2 gray-6"
          type="text"
          size="small"
          icon={<SaveOutlined />}
          onClick={() => onOpenSaveAsViewModal({ sql })}
        >
          Save as view
        </Button>
      </Typography>
    </Skeleton>
  );
}
