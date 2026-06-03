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

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const submit = async (values: any) => {
    setLoading(true);
    const endpoint = auth.bootstrapRequired
      ? '/api/auth/bootstrap'
      : '/api/auth/login';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
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
          {auth.bootstrapRequired ? 'Create your Admin account' : 'Sign in'}
        </Title>
        <Paragraph className="gray-7">
          {auth.bootstrapRequired
            ? 'Set up the first organization and Admin member.'
            : 'Access your Wren AI workspace.'}
        </Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          {auth.bootstrapRequired && (
            <Form.Item
              label="Organization"
              name="organizationName"
              rules={[{ required: true, message: 'Organization is required.' }]}
            >
              <Input placeholder="Acme Analytics" />
            </Form.Item>
          )}
          {auth.bootstrapRequired && (
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: 'Name is required.' }]}
            >
              <Input placeholder="Jane Doe" />
            </Form.Item>
          )}
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: 'Email is required.' },
              { type: 'email', message: 'Enter a valid email.' },
            ]}
          >
            <Input placeholder="jane@example.com" />
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
          <Button type="primary" htmlType="submit" block loading={loading}>
            {auth.bootstrapRequired ? 'Create workspace' : 'Sign in'}
          </Button>
        </Form>
      </Panel>
    </Layout>
  );
}
