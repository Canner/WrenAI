import { useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { useAuth } from '@/hooks/useAuth';
import { Path } from '@/utils/enum';

const { Paragraph, Title } = Typography;

const Layout = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gray-2);
`;

const Panel = styled(Card)`
  width: 420px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
`;

export default function AcceptInvitationPage() {
  const router = useRouter();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const token = `${router.query.token || ''}`;

  const submit = async (values: any) => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, token }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      await auth.refresh();
      await router.replace(Path.Home);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <Panel>
        <div className="mb-6">
          <LogoBar />
        </div>
        <Title level={3} className="mb-2">
          Accept invitation
        </Title>
        <Paragraph className="gray-7">
          Create your member profile to access this Wren AI workspace.
        </Paragraph>
        <Form layout="vertical" onFinish={submit}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required.' }]}
          >
            <Input placeholder="Jane Doe" />
          </Form.Item>
          <Form.Item
            label="Password"
            name="password"
            rules={[
              { required: true, message: 'Password is required.' },
              { min: 8, message: 'Use at least 8 characters.' },
            ]}
          >
            <Input.Password placeholder="Password" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            disabled={!token}
          >
            Join workspace
          </Button>
        </Form>
      </Panel>
    </Layout>
  );
}
