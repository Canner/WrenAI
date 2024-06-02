import Image from 'next/image';
import Link from 'next/link';
import { Alert, Typography, Form, Row, Col, Button } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { getDataSource, getPostgresErrorMessage } from './utils';

const StyledForm = styled(Form)`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
`;

const DataSource = styled.div`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
`;

interface Props {
  dataSource: DATA_SOURCES;
  onNext: (data: any) => void;
  onBack: () => void;
  submitting: boolean;
  connectError?: Record<string, any>;
}

export default function ConnectDataSource(props: Props) {
  const { connectError, dataSource, submitting, onNext, onBack } = props;
  const [form] = Form.useForm();
  const current = getDataSource(dataSource);

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ properties: values });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <>
      <Typography.Title level={1} className="mb-3">
        Connect the data source
      </Typography.Title>
      <Typography.Text>
        Vote for your favorite data sources on{' '}
        <Link
          href="https://github.com/Canner/WrenAI/discussions/327"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Link>
        .
      </Typography.Text>

      <StyledForm form={form} layout="vertical" className="p-6 my-6">
        <Row align="middle" className="mb-6">
          <Col span={12}>
            <DataSource className="d-inline-block px-4 py-2 bg-gray-2 gray-8">
              <Image
                className="mr-2"
                src={current.logo}
                alt={dataSource}
                width="40"
                height="40"
              />
              {current.label}
            </DataSource>
          </Col>
          <Col className="text-right" span={12}>
            Learn more information in the {current.label}{' '}
            <Link
              href={current.guide}
              target="_blank"
              rel="noopener noreferrer"
            >
              setup guide
            </Link>
            .
          </Col>
        </Row>
        <current.component />
      </StyledForm>

      {connectError && (
        <Alert
          message={connectError.shortMessage}
          description={
            dataSource === DATA_SOURCES.PG_SQL
              ? getPostgresErrorMessage(connectError)
              : connectError.message
          }
          type="error"
          showIcon
          className="my-6"
        />
      )}

      <Row gutter={16} className="pt-6">
        <Col span={12}>
          <Button
            onClick={onBack}
            size="large"
            className="adm-onboarding-btn"
            disabled={submitting}
          >
            Back
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button
            type="primary"
            size="large"
            onClick={submit}
            loading={submitting}
            className="adm-onboarding-btn"
          >
            Next
          </Button>
        </Col>
      </Row>
    </>
  );
}
