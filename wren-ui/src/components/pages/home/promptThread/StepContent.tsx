import { Avatar, Button, ButtonProps, Col, Row, Typography } from 'antd';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { BinocularsIcon } from '@/utils/icons';
import CollapseContent, {
  Props as CollapseContentProps,
} from '@/components/pages/home/promptThread/CollapseContent';
import useAnswerStepContent from '@/hooks/useAnswerStepContent';

const { Title, Paragraph } = Typography;

interface Props {
  fullSql: string;
  isLastStep: boolean;
  sql: string;
  stepNumber: number;
  summary: string;
}

export default function StepContent(props: Props) {
  const { fullSql, isLastStep, sql, stepNumber, summary } = props;

  const {
    collapseContentProps,
    previewDataButtonProps,
    viewSQLButtonProps,
    viewSQLButtonText,
  } = useAnswerStepContent({
    fullSql,
    isLastStep,
    sql,
  });

  return (
    <Row className="mb-3 bg-gray-2" wrap={false}>
      <Col flex="32px" className="p-2">
        <Avatar
          alt={`step-${stepNumber}`}
          className="adm-avatar-xs bg-gray-5 gray-7"
        >
          {stepNumber}
        </Avatar>
      </Col>
      <Col flex="auto" className="pt-2 pl-2 pr-8 pb-4">
        <Paragraph>
          <Title level={5} style={{ fontWeight: 400 }}>
            {summary}
          </Title>
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
        >
          Preview Data
        </Button>
        <Button
          {...(viewSQLButtonProps as ButtonProps)}
          size="small"
          icon={<FunctionOutlined />}
        >
          {viewSQLButtonText}
        </Button>
        <CollapseContent
          {...(collapseContentProps as CollapseContentProps)}
          key={`collapse-${stepNumber}`}
        />
      </Col>
    </Row>
  );
}
