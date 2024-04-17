import { Button, Input, Popover, Space, Typography } from 'antd';
import styled from 'styled-components';
import { ShareIcon } from '@/utils/icons';
import { useConnectionInfoQuery } from '@/apollo/client/graphql/deploy.generated';

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

  .ant-typography-copy {
    color: var(--gray-8);
  }

  .ant-typography-copy-success:focus {
    color: var(--green-6);
  }
`;

export default function SharePopover() {
  const { data } = useConnectionInfoQuery();
  const connections = data?.connectionInfo;

  const sources = [
    { title: 'Database', type: 'text', value: connections?.database },
    { title: 'Port', type: 'text', value: String(connections?.port || '') },
    { title: 'Username', type: 'text', value: connections?.username },
    { title: 'Password', type: 'password', value: connections?.password },
  ];

  const content = (
    <Content>
      <Title className="adm-share-title">
        <Space>
          <ShareIcon />
          Share
        </Space>
      </Title>
      <div style={{ marginBottom: 16 }}>
        You can connect applications via our protocol.
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
    <Popover content={content} trigger="click" placement="bottomRight">
      <Button size="small" type="primary" className="adm-modeling-header-btn">
        Share
      </Button>
    </Popover>
  );
}
