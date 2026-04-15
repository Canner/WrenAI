import Image from 'next/image';
import Link from 'next/link';
import { Alert, Button, Form, Space, Typography } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { getDataSource, getPostgresErrorMessage } from './utils';

const { Paragraph, Text, Title } = Typography;

const PageSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 26px;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
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
  margin-bottom: 12px;
`;

const SourceHero = styled.div`
  min-width: 240px;
  border-radius: 24px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, #ffffff 0%, #faf9ff 100%);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.05);
  padding: 18px;
`;

const HeroChip = styled.div`
  width: fit-content;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.08);
  color: #6f47ff;
  font-size: 12px;
  font-weight: 700;
`;

const SourceRow = styled.div`
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const SourceIcon = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: rgba(111, 71, 255, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const StyledForm = styled(Form)`
  border-radius: 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 24px 50px rgba(15, 23, 42, 0.05);
  padding: 26px 26px 8px;

  .ant-form-item {
    margin-bottom: 18px;
  }

  .ant-form-item-label {
    padding-bottom: 8px;
  }

  .ant-form-item-label > label {
    color: #5d6478;
    font-size: 13px;
    font-weight: 600;
  }

  .ant-input,
  .ant-input-password,
  .ant-input-affix-wrapper,
  .ant-select-selector,
  .ant-radio-button-wrapper {
    border-radius: 12px !important;
    border-color: rgba(15, 23, 42, 0.1) !important;
    box-shadow: none !important;
  }

  .ant-input,
  .ant-input-affix-wrapper,
  .ant-input-password {
    min-height: 44px;
    padding: 10px 14px;
  }

  .ant-switch {
    background: rgba(15, 23, 42, 0.16);
  }
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 4px;
`;

const LightButton = styled(Button)`
  &.ant-btn {
    min-width: 132px;
    height: 46px;
    border-radius: 14px;
    border: 0;
    background: #f2f4f8;
    color: #4f5565;
    font-weight: 700;
    box-shadow: none;
  }
`;

const PrimaryButton = styled(Button)`
  &.ant-btn {
    min-width: 132px;
    height: 46px;
    border-radius: 14px;
    border: 0;
    background: linear-gradient(180deg, #8c61ff 0%, #6f47ff 100%);
    color: #fff;
    font-weight: 700;
    box-shadow: 0 14px 30px rgba(111, 71, 255, 0.24);
  }
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
  const sourceLogo = current.logo || '/images/data-sources/duckdb.png';
  const sourceGuide = current.guide || '#';

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ properties: values });
      })
      .catch(() => {
        // form validation errors are displayed by antd fields
      });
  };

  return (
    <PageSection>
      <HeaderRow>
        <div style={{ maxWidth: 760 }}>
          <Badge>Step 1 / 数据源配置</Badge>
          <Title level={2} style={{ margin: 0, fontSize: 30 }}>
            连接当前数据源
          </Title>
          <Paragraph
            style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.8 }}
          >
            完成连接后即可把该数据源纳入当前知识库，用于后续问答、分析规则、技能调用和
            SQL 模板编排。
          </Paragraph>
        </div>
        <SourceHero>
          <HeroChip>当前选择</HeroChip>
          <SourceRow>
            <SourceIcon>
              <Image src={sourceLogo} alt={dataSource} width="52" height="52" />
            </SourceIcon>
            <div>
              <Text
                strong
                style={{ display: 'block', fontSize: 16, color: '#1f2435' }}
              >
                {current.label}
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                连接后进入资产选择与知识配置
              </Text>
            </div>
          </SourceRow>
          {sourceGuide !== '#' ? (
            <Link href={sourceGuide} target="_blank" rel="noopener noreferrer">
              <Text style={{ color: '#6f47ff', fontWeight: 600 }}>
                查看接入指南 →
              </Text>
            </Link>
          ) : null}
        </SourceHero>
      </HeaderRow>

      <StyledForm form={form} layout="vertical">
        <current.component />
      </StyledForm>

      {connectError && (
        <Alert
          message={connectError.shortMessage}
          description={
            dataSource === DATA_SOURCES.POSTGRES
              ? getPostgresErrorMessage(connectError)
              : connectError.message
          }
          type="error"
          showIcon
        />
      )}

      <FooterRow>
        <Text type="secondary" style={{ fontSize: 13 }}>
          下一步会进入模型表选择。你可以稍后返回继续调整连接信息。
        </Text>
        <Space size={12}>
          <LightButton onClick={onBack} disabled={submitting}>
            返回
          </LightButton>
          <PrimaryButton type="primary" onClick={submit} loading={submitting}>
            下一步
          </PrimaryButton>
        </Space>
      </FooterRow>
    </PageSection>
  );
}
