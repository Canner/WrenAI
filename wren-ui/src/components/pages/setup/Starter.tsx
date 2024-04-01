import Link from 'next/link';
import Image from 'next/image';
import { Button, Typography, Row, Col } from 'antd';
import styled from 'styled-components';
import { ButtonOption, getDataSources, getTemplates } from './utils';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

const ButtonItem = styled(Button)`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
  width: 100%;
  height: auto;

  &:disabled {
    opacity: 0.5;
  }
`;

const PlainImage = styled.div`
  border: 1px var(--gray-4) solid;
  background-color: white;
  width: 40px;
  height: 40px;
`;

const CommingSoon = styled.div`
  border: 1px var(--gray-7) solid;
  color: var(gray-7);
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 999px;
  &:before {
    content: 'COMMING SOON';
  }
`;

const ButtonTemplate = (
  props: IterableComponent<
    ButtonOption & { value: string; onSelect: (value: string) => void }
  >,
) => {
  const { value, disabled, logo, label, onSelect } = props;
  return (
    <Col span={6} key={value}>
      <ButtonItem
        className="text-left px-4 py-2 bg-gray-2 gray-8 d-flex justify-space-between align-center"
        disabled={disabled}
        onClick={() => onSelect(value)}
      >
        <div className="d-flex align-center">
          {logo ? (
            <Image
              className="mr-2"
              src={logo}
              alt={label}
              width="40"
              height="40"
            />
          ) : (
            <PlainImage className="mr-2" />
          )}
          {label}
        </div>
        {disabled && <CommingSoon />}
      </ButtonItem>
    </Col>
  );
};

const DataSourceIterator = makeIterable(ButtonTemplate);
const TemplatesIterator = makeIterable(ButtonTemplate);

export default function Starter(props) {
  const { onNext } = props;
  const dataSources = getDataSources();
  const templates = getTemplates();

  const onSelectDataSource = (value: DataSourceName) => {
    onNext && onNext({ dataSource: value });
  };

  const onSelectTemplate = (value: string) => {
    onNext && onNext({ template: value });
  };

  return (
    <>
      <Typography.Title level={1} className="mb-3">
        Connect a data source
      </Typography.Title>
      <Typography.Text>
        Vote for your preferred data source to be our next option on our{' '}
        <Link
          href="https://github.com/Canner/WrenAI/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Link>
        .
      </Typography.Text>
      <Row className="mt-6" gutter={[16, 16]}>
        <DataSourceIterator data={dataSources} onSelect={onSelectDataSource} />
      </Row>

      <div className="py-8" />

      <Typography.Title level={1} className="mb-3">
        Play around with sample data
      </Typography.Title>
      <Row className="mt-6" gutter={[16, 16]}>
        <TemplatesIterator data={templates} onSelect={onSelectTemplate} />
      </Row>

      <div className="py-12" />
    </>
  );
}
