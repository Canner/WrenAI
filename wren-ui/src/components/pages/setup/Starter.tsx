import { DataSourceName } from '@/types/dataSource';
import { ComponentProps } from 'react';
import { Col, Row, Typography } from 'antd';
import styled from 'styled-components';
import { getConnectionTypes } from './utils';
import { makeIterable } from '@/utils/iteration';
import ButtonItem from './ButtonItem';

const { Paragraph, Title } = Typography;

const Section = styled.section`
  display: flex;
  flex-direction: column;
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

const ButtonTemplate = (props: ComponentProps<typeof ButtonItem>) => {
  return (
    <Col xs={24} md={12} xl={8} key={props.label}>
      <ButtonItem {...props} />
    </Col>
  );
};

const ConnectionTypeIterator = makeIterable(ButtonTemplate);
interface StarterProps {
  onNext?: (value: { connectionType?: DataSourceName }) => void;
  submitting: boolean;
}

export default function Starter(props: StarterProps) {
  const { onNext, submitting } = props;

  const connectionTypes = getConnectionTypes();

  const onSelectConnectionType = (value: DataSourceName) => {
    onNext && onNext({ connectionType: value });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Section>
        <HeaderMeta>
          <Badge>Step 1 / 连接方式</Badge>
          <Title level={2} style={{ margin: 0, fontSize: 28 }}>
            创建知识库连接
          </Title>
          <Paragraph style={{ marginBottom: 0, fontSize: 15, lineHeight: 1.8 }}>
            为当前知识库选择连接类型并填写真实业务系统的访问信息。保存后会创建或更新该知识库的主连接，随后进入资产选择与关系配置。
          </Paragraph>
        </HeaderMeta>

        <Row gutter={[18, 18]}>
          <ConnectionTypeIterator
            data={connectionTypes}
            onSelect={onSelectConnectionType}
            submitting={submitting}
          />
        </Row>
      </Section>
    </div>
  );
}
