import Link from 'next/link';
import Image from 'next/image';
import { Button, Typography, Row, Col } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum';
import { ButtonOption, getDataSources, getTemplates } from './utils';
import {
  makeIterable,
  IterableComponent,
} from '@/utils/iteration';

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
  >
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

export default function Starter(props) {
  const { onNext } = props;
  const dataSources = getDataSources();
  const templates = getTemplates();

  const DataSourceIterator = makeIterable(ButtonTemplate);
  const TemplatesIterator = makeIterable(ButtonTemplate);

  const onSelectDataSource = (value: DATA_SOURCES) => {
    onNext && onNext({ dataSource: value });
  };

  const onSelectTemplate = (value: string) => {
    onNext && onNext({ template: value });
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
      <Row className="mt-6" gutter={16}>
        <DataSourceIterator data={dataSources} onSelect={onSelectDataSource} />
      </Row>

      <div className="py-8" />

      <Typography.Title level={1} className="mb-3">
        or play around with a template
      </Typography.Title>
      <Row className="mt-6" gutter={16}>
        <TemplatesIterator data={templates} onSelect={onSelectTemplate} />
      </Row>

      <div className="py-12" />
    </>
  );
}
