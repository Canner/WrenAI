import { Skeleton, Typography } from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import StepContent from '@/components/pages/home/promptThread/StepContent';

const { Title } = Typography;

interface Props {
  loading: boolean;
  question: string;
  description: string;
  answerResultSteps: Array<{
    summary: string;
    sql: string;
  }>;
  fullSql: string;
}

export default function AnswerResult(props: Props) {
  const { loading, question, description, answerResultSteps, fullSql } = props;

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
        {(answerResultSteps || []).map((step, index) => (
          <StepContent
            isLastStep={index === answerResultSteps.length - 1}
            key={`${step.summary}-${index}`}
            sql={step.sql}
            fullSql={fullSql}
            stepNumber={index + 1}
            summary={step.summary}
          />
        ))}
      </Typography>
    </Skeleton>
  );
}
