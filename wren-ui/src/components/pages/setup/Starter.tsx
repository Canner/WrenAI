import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { Button, Typography, Row, Col } from 'antd';
import Icon from '@ant-design/icons';
import styled from 'styled-components';
import { ButtonOption, getDataSources, getTemplates } from './utils';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

const ButtonItem = styled(Button)`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
  width: 100%;
  height: auto;

  &:disabled {
    opacity: 0.5;
  }

  // loading of button
  .ant-btn-loading-icon .anticon {
    font-size: 24px;
  }
`;

const PlainImage = styled.div`
  border: 1px var(--gray-4) solid;
  background-color: white;
  width: 40px;
  height: 40px;
`;

const ComingSoon = styled.div`
  border: 1px var(--gray-7) solid;
  color: var(gray-7);
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 999px;
  &:before {
    content: 'COMING SOON';
  }
`;

const ButtonTemplate = (
  props: IterableComponent<
    ButtonOption & {
      value: string;
      onSelect: (value: string) => void;
      selectedTemplate?: string;
    }
  >,
) => {
  const {
    value,
    disabled,
    submitting,
    logo,
    IconComponent,
    label,
    onSelect,
    selectedTemplate,
  } = props;

  const loading = selectedTemplate === value;

  return (
    <Col span={6} key={value}>
      <ButtonItem
        className={`text-left px-4 py-2 bg-gray-2 gray-8 d-flex align-center ${loading ? 'flex-start' : 'justify-space-between'}`}
        disabled={disabled || submitting}
        loading={loading}
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
          ) : IconComponent ? (
            <Icon
              component={IconComponent}
              className="mr-2 p-1"
              style={{ width: 40, height: 40, fontSize: 32 }}
            />
          ) : (
            <PlainImage className="mr-2" />
          )}
          {label}
        </div>
        {disabled && <ComingSoon />}
      </ButtonItem>
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
        Vote for your favorite data sources on {' '}
        <Link
          href="https://github.com/Canner/WrenAI"
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
