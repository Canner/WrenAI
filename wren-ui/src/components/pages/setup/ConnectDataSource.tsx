import Image from 'next/image';
import Link from 'next/link';
import { Typography, Form, Row, Col, Button } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { getDataSource } from './utils';

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
}

export default function ConnectDataSource(props: Props) {
  const { dataSource, onNext, onBack } = props;
  const [form] = Form.useForm();
  const current = getDataSource(dataSource);

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext(values);
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
        We only support BigQuery for now. You can vote for your warehouse in our{' '}
        <Link
          href="https://github.com/Canner/vulcan-sql/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub issues
        </Link>
        !
      </Typography.Text>

      <StyledForm form={form} layout="vertical" className="p-6 mt-6">
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
            Learn {current.label} <Link href={current.guide}>setup guide</Link>.
          </Col>
        </Row>
        <current.component />
      </StyledForm>

      <Row gutter={16} className="pt-6">
        <Col span={12}>
          <Button onClick={onBack} size="large" block>
            Back
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button type="primary" size="large" block onClick={submit}>
            Next
          </Button>
        </Col>
      </Row>
    </>
  );
}
