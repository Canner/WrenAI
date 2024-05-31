import Link from 'next/link';
import { ComponentProps, useState } from 'react';
import { Typography, Row, Col } from 'antd';
import { getDataSources, getTemplates } from './utils';
import { makeIterable } from '@/utils/iteration';
import ButtonItem from './ButtonItem';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

const ButtonTemplate = (props: ComponentProps<typeof ButtonItem>) => {
  return (
    <Col span={6} key={props.label}>
      <ButtonItem {...props} />
    </Col>
  );
};

const DataSourceIterator = makeIterable(ButtonTemplate);
const TemplatesIterator = makeIterable(ButtonTemplate);

export default function Starter(props) {
  const { onNext, submitting } = props;

  const [template, setTemplate] = useState<SampleDatasetName>();

  const dataSources = getDataSources();
  const templates = getTemplates();

  const onSelectDataSource = (value: DataSourceName) => {
    onNext && onNext({ dataSource: value });
  };

  const onSelectTemplate = (value: string) => {
    setTemplate(value as SampleDatasetName);
    onNext && onNext({ template: value });
  };

  return (
    <>
      <Typography.Title level={1} className="mb-3">
        Connect a data source
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
      <Row className="mt-6" gutter={[16, 16]}>
        <DataSourceIterator
          data={dataSources}
          onSelect={onSelectDataSource}
          submitting={submitting}
        />
      </Row>

      <div className="py-8" />

      <Typography.Title level={1} className="mb-3">
        Play around with sample data
      </Typography.Title>
      <Row className="mt-6" gutter={[16, 16]}>
        <TemplatesIterator
          data={templates}
          onSelect={onSelectTemplate}
          submitting={submitting}
          selectedTemplate={template}
        />
      </Row>

      <div className="py-12" />
    </>
  );
}
