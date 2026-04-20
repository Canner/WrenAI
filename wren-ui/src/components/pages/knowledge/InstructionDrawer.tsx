import { Drawer, Tag, Typography } from 'antd';
import styled from 'styled-components';
import { getCompactTime } from '@/utils/time';
import QuestionOutlined from '@ant-design/icons/QuestionOutlined';
import { DrawerAction } from '@/hooks/useDrawerAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import type { Instruction } from '@/types/knowledge';

const { Text } = Typography;

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

type Props = DrawerAction<Instruction>;

export default function InstructionDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;

  return (
    <StyledDrawer
      closable
      destroyOnClose
      onClose={onClose}
      title="分析规则详情"
      open={visible}
      width={760}
    >
      <Section>
        <Label>规则内容</Label>
        <Value>{defaultValue?.instruction || '-'}</Value>
      </Section>
      <Section>
        <Label>匹配问题示例</Label>
        <div>
          {defaultValue?.isDefault ? (
            <>
              <GlobalLabel />
              <Text className="gray-7 ml-2" type="secondary">
                （适用于所有问题）
              </Text>
            </>
          ) : (
            defaultValue?.questions.map((question, index) => (
              <div key={`${question}-${index}`} className="my-2">
                <Tag
                  className="bg-gray-1 border-gray-5"
                  style={{ borderRadius: 999, paddingInline: 10 }}
                >
                  <QuestionOutlined className="geekblue-6" />
                  <Text className="gray-9">{question}</Text>
                </Tag>
              </div>
            ))
          )}
        </div>
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
