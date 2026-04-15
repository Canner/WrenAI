import Link from 'next/link';
import { Button, Form, Space, Typography } from 'antd';
import styled from 'styled-components';
import type { ColumnsType } from 'antd/es/table';
import { ERROR_TEXTS } from '@/utils/error';
import MultiSelectBox from '@/components/table/MultiSelectBox';
import { CompactTable } from '@/apollo/client/graphql/__types__';
import {
  getCompactTableBaseName,
  getCompactTableCatalogLabel,
  getCompactTableQualifiedName,
  getCompactTableSchemaLabel,
} from '@/utils/compactTable';

const { Paragraph, Text, Title } = Typography;

const PageSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
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

const SelectionStage = styled.div`
  border-radius: 24px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.05);
  padding: 22px;
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
  fetching: boolean;
  tables: CompactTable[];
  onNext: (data: { selectedTables: string[] }) => void;
  onBack: () => void;
  submitting: boolean;
}

type SelectModelItem = CompactTable & {
  value: string;
  catalogLabel: string;
  schemaLabel: string;
  tableLabel: string;
  qualifiedName: string;
};

const columns: ColumnsType<SelectModelItem> = [
  {
    title: 'Catalog',
    dataIndex: 'catalogLabel',
    width: 180,
  },
  {
    title: 'Schema',
    dataIndex: 'schemaLabel',
    width: 160,
  },
  {
    title: '数据表',
    dataIndex: 'tableLabel',
  },
];

export default function SelectModels(props: Props) {
  const { fetching, tables, onBack, onNext, submitting } = props;
  const [form] = Form.useForm();

  const items: SelectModelItem[] = tables
    .map((item) => ({
      ...item,
      value: item.name,
      catalogLabel: getCompactTableCatalogLabel(item),
      schemaLabel: getCompactTableSchemaLabel(item),
      tableLabel: getCompactTableBaseName(item),
      qualifiedName: getCompactTableQualifiedName(item),
    }))
    .sort((left, right) =>
      left.qualifiedName.localeCompare(right.qualifiedName),
    );

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ selectedTables: values.tables });
      })
      .catch(() => {
        // form validation errors are displayed by antd fields
      });
  };

  return (
    <PageSection>
      <HeaderMeta>
        <Badge>Step 2 / 模型表选择</Badge>
        <Title level={2} style={{ margin: 0, fontSize: 30 }}>
          选择要建模的数据表
        </Title>
        <Paragraph style={{ marginBottom: 0, fontSize: 15, lineHeight: 1.8 }}>
          系统会基于你选择的数据表创建语义模型，帮助 AI
          更准确理解当前知识库的数据结构。你也可以在后续建模页继续增减表与字段。
          <br />
          <Link
            href="https://docs.getwren.ai/oss/guide/modeling/overview"
            target="_blank"
            rel="noopener noreferrer"
          >
            了解数据模型 →
          </Link>
        </Paragraph>
      </HeaderMeta>

      <SelectionStage>
        <Form form={form} layout="vertical">
          <Form.Item
            name="tables"
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SETUP_MODEL.TABLE.REQUIRED,
              },
            ]}
          >
            <MultiSelectBox
              columns={columns}
              items={items}
              loading={fetching}
            />
          </Form.Item>
        </Form>
      </SelectionStage>

      <FooterRow>
        <Text type="secondary" style={{ fontSize: 13 }}>
          至少选择一张表后即可进入关系配置。若当前数据源中表很多，建议先只保留本次问答最核心的主题表。
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
