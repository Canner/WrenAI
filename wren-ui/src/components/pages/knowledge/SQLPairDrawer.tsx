import { Drawer, Typography } from 'antd';
import styled from 'styled-components';
import { getCompactTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import { SqlPair } from '@/apollo/client/graphql/__types__';

const StyledDrawer = styled(Drawer)`
  .ant-drawer-header {
    border-bottom: 1px solid #eef2f7;
    padding: 18px 20px;
  }

  .ant-drawer-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  .ant-drawer-body {
    padding: 20px;
    background: #fff;
  }
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 0;
  border-bottom: 1px solid #f1f5f9;

  &:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
`;

const Label = styled(Typography.Text)`
  &.ant-typography {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    margin-bottom: 0;
  }
`;

const Value = styled.div`
  color: #111827;
  font-size: 14px;
  line-height: 1.8;
`;

type Props = DrawerAction<SqlPair>;

export default function SQLPairDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;

  return (
    <StyledDrawer
      closable
      destroyOnClose
      onClose={onClose}
      title="SQL 模板详情"
      visible={visible}
      width={760}
    >
      <Section>
        <Label>问题</Label>
        <Value>{defaultValue?.question || '-'}</Value>
      </Section>
      <Section>
        <Label>SQL 语句</Label>
        <SQLCodeBlock
          code={defaultValue?.sql || ''}
          showLineNumbers
          maxHeight="500"
        />
      </Section>
      <Section>
        <Label>创建时间</Label>
        <Value>
          {defaultValue?.createdAt
            ? getCompactTime(defaultValue.createdAt)
            : '-'}
        </Value>
      </Section>
    </StyledDrawer>
  );
}
