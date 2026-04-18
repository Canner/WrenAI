import Image from 'next/image';
import { Alert, Button, Form, Space, Typography } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/connectionTypes';
import { getConnectionType, getPostgresErrorMessage } from './utils';

const { Paragraph, Text, Title } = Typography;

const PageSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
  margin-bottom: 8px;
`;

const SourceHero = styled.div`
  min-width: 220px;
  border-radius: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.04);
  padding: 14px 16px;
`;

const HeroChip = styled.div`
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.08);
  color: #6f47ff;
  font-size: 11px;
  font-weight: 700;
`;

const SourceRow = styled.div`
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const SourceIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(111, 71, 255, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const StyledForm = styled(Form)`
  border-radius: 24px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.04);
  padding: 20px 20px 6px;

  .ant-form-item {
    margin-bottom: 14px;
  }

  .ant-form-item-label {
    padding-bottom: 6px;
  }

  .ant-form-item-label > label {
    color: #5d6478;
    font-size: 12px;
    font-weight: 600;
  }

  .ant-form-item-extra,
  .ant-form-item-explain,
  .ant-form-item-explain-error {
    font-size: 12px;
    line-height: 1.5;
  }

  .ant-input,
  .ant-input-number,
  .ant-input-password,
  .ant-input-affix-wrapper,
  .ant-select-selector,
  .ant-radio-button-wrapper {
    border-radius: 12px !important;
    border-color: rgba(15, 23, 42, 0.1) !important;
    box-shadow: none !important;
  }

  .ant-input,
  .ant-input-number,
  .ant-input-number-input,
  .ant-input-affix-wrapper,
  .ant-input-password {
    min-height: 40px;
    padding: 8px 12px;
  }

  textarea.ant-input {
    min-height: auto;
    padding: 10px 12px;
  }

  .ant-input-affix-wrapper > input.ant-input,
  .ant-input-password .ant-input {
    min-height: auto;
    padding: 0;
  }

  .ant-select-selector,
  .ant-radio-button-wrapper,
  .ant-upload-wrapper .ant-btn,
  .ant-btn.ant-btn-dashed {
    min-height: 40px;
  }

  .ant-upload-wrapper .ant-btn,
  .ant-btn.ant-btn-dashed {
    border-radius: 12px;
    padding: 8px 12px;
    box-shadow: none;
  }

  .connection-form-grid {
    display: flex;
    flex-direction: column;
  }

  .connection-form-grid.compact {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 14px;
    align-items: start;
  }

  .connection-form-grid.compact > .form-span-2 {
    grid-column: 1 / -1;
  }

  .ant-switch {
    background: rgba(15, 23, 42, 0.16);
  }
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 0;
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
  connectionType: DATA_SOURCES;
  onNext: (data: any) => void;
  onBack: () => void;
  submitting: boolean;
  connectError?: Record<string, any>;
}

const COMPACT_GRID_CONNECTION_TYPES = new Set<DATA_SOURCES>([
  DATA_SOURCES.BIG_QUERY,
  DATA_SOURCES.POSTGRES,
  DATA_SOURCES.MYSQL,
  DATA_SOURCES.ORACLE,
  DATA_SOURCES.MSSQL,
  DATA_SOURCES.CLICK_HOUSE,
  DATA_SOURCES.TRINO,
]);

export default function ConfigureConnection(props: Props) {
  const { connectError, connectionType, submitting, onNext, onBack } = props;
  const [form] = Form.useForm();
  const current = getConnectionType(connectionType);
  const sourceLogo = current.logo || '/images/data-sources/duckdb.png';
  const useCompactGrid = COMPACT_GRID_CONNECTION_TYPES.has(connectionType);

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
          <Badge>Step 1 / 连接配置</Badge>
          <Title level={2} style={{ margin: 0, fontSize: 30 }}>
            填写连接信息
          </Title>
          <Paragraph
            style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.75 }}
          >
            保存后会为当前知识库创建或更新主连接，下一步即可从该连接里选择资产并继续配置语义关系。
          </Paragraph>
        </div>
        <SourceHero>
          <HeroChip>当前选择</HeroChip>
          <SourceRow>
            <SourceIcon>
              <Image
                src={sourceLogo}
                alt={connectionType}
                width="44"
                height="44"
              />
            </SourceIcon>
            <div>
              <Text
                strong
                style={{ display: 'block', fontSize: 15, color: '#1f2435' }}
              >
                {current.label}
              </Text>
            </div>
          </SourceRow>
        </SourceHero>
      </HeaderRow>

      <StyledForm form={form} layout="vertical">
        <div
          className={`connection-form-grid${useCompactGrid ? ' compact' : ''}`}
        >
          <current.component />
        </div>
      </StyledForm>

      {connectError && (
        <Alert
          message={connectError.shortMessage}
          description={
            connectionType === DATA_SOURCES.POSTGRES
              ? getPostgresErrorMessage(connectError)
              : connectError.message
          }
          type="error"
          showIcon
        />
      )}

      <FooterRow>
        <Text type="secondary" style={{ fontSize: 12 }}>
          下一步进入资产选择，之后仍可返回调整连接信息。
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
