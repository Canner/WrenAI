import { ComponentProps, useState } from 'react';
import { Col, Row, Typography } from 'antd';
import styled from 'styled-components';
import { getDataSources, getTemplates } from './utils';
import { makeIterable } from '@/utils/iteration';
import ButtonItem from './ButtonItem';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

const { Paragraph, Text, Title } = Typography;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
`;

const HeaderMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
`;

const Badge = styled.div`
  width: fit-content;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.08);
  color: #6f47ff;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
`;

const HintCard = styled.div`
  width: min(100%, 280px);
  border-radius: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, #fff 0%, #faf9ff 100%);
  padding: 18px;
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.05);
`;

const Divider = styled.div`
  height: 1px;
  background: rgba(15, 23, 42, 0.08);
  margin: 6px 0 2px;
`;

const ButtonTemplate = (props: ComponentProps<typeof ButtonItem>) => {
  return (
    <Col xs={24} md={12} xl={8} key={props.label}>
      <ButtonItem {...props} />
    </Col>
  );
};

const DataSourceIterator = makeIterable(ButtonTemplate);
const TemplatesIterator = makeIterable(ButtonTemplate);

interface StarterProps {
  onNext?: (value: { dataSource?: DataSourceName; template?: string }) => void;
  submitting: boolean;
}

export default function Starter(props: StarterProps) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
      <Section>
        <SectionHeader>
          <HeaderMeta>
            <Badge>Step 1 / 接入方式</Badge>
            <Title level={2} style={{ margin: 0, fontSize: 28 }}>
              连接真实数据源
            </Title>
            <Paragraph
              style={{ marginBottom: 0, fontSize: 15, lineHeight: 1.8 }}
            >
              为知识库接入数据库、数仓或外部分析系统。完成后会进入资产选择与关系配置，快速形成可问答的语义层。
            </Paragraph>
          </HeaderMeta>
          <HintCard>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              推荐路径
            </Text>
            <Text type="secondary" style={{ lineHeight: 1.7 }}>
              先用真实数据源完成接入；如果只想快速预览效果，可直接选择下方的两套系统样例数据。
            </Text>
          </HintCard>
        </SectionHeader>

        <Row gutter={[18, 18]}>
          <DataSourceIterator
            data={dataSources}
            onSelect={onSelectDataSource}
            submitting={submitting}
          />
        </Row>
      </Section>

      <Divider />

      <Section>
        <HeaderMeta>
          <Badge>Step 1 / 样例体验</Badge>
          <Title level={2} style={{ margin: 0, fontSize: 28 }}>
            或者先体验内置样例数据
          </Title>
          <Paragraph style={{ marginBottom: 0, fontSize: 15, lineHeight: 1.8 }}>
            推荐优先体验“电商订单数据”和“人力资源数据”两套样例，便于快速验证问数、分析规则和
            SQL 模板效果。
          </Paragraph>
        </HeaderMeta>

        <Row gutter={[18, 18]}>
          <TemplatesIterator
            data={templates}
            onSelect={onSelectTemplate}
            submitting={submitting}
            selectedTemplate={template}
          />
        </Row>
      </Section>
    </div>
  );
}
