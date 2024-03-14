import { Popover, PopoverProps, Typography, Input, Space } from 'antd';
import { ShareIcon } from '@/utils/icons';
import styled from 'styled-components';

const { Title, Text } = Typography;

const Content = styled.div`
  width: 423px;
  padding: 4px 0;

  .adm-share-title {
    font-size: 14px;
    margin-bottom: 16px;
  }

  .adm-share-subtitle {
    margin-bottom: 8px;
  }
`;

const StyledInput = styled(Input)`
  display: block;
  color: var(--gray-10);

  .ant-input {
    background-color: var(--gray-4);
  }
`;

type Source = { title: string; type: string; value: string };

type Props = {
  sources: Source[];
} & PopoverProps;

export default function SharePopover(props: Props) {
  const { children, sources } = props;

  const content = (
    <Content>
      <Title className="adm-share-title">
        <Space>
          <ShareIcon />
          Share
        </Space>
      </Title>
      <div style={{ marginBottom: 16 }}>
        You can connect it to query via SQL protocol.
      </div>

      <Space style={{ width: '100%' }} direction="vertical" size={[0, 16]}>
        {sources.map(({ title, type, value }) => (
          <div key={title}>
            <div className="adm-share-subtitle">{title}</div>
            <StyledInput
              type={type}
              readOnly
              value={value}
              addonAfter={
                <Text
                  copyable={{ text: value, tooltips: ['Copy', 'Copied!'] }}
                />
              }
            />
          </div>
        ))}
      </Space>
    </Content>
  );
  return (
    <Popover content={content} trigger="hover" placement="bottomRight">
      {children}
    </Popover>
  );
}
