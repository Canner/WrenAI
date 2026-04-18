import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Alert, Button, Form, Input, Spin, Switch, Typography } from 'antd';
import styled from 'styled-components';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import NovaBrandMark from '@/components/brand/NovaBrandMark';
import useAuthSession, {
  AuthSessionPayload,
  clearAuthSessionCache,
} from '@/hooks/useAuthSession';
import {
  resolvePostAuthRedirectPath,
  sanitizeLocalRedirectPath,
} from '@/utils/authRedirect';
import { Path } from '@/utils/enum';

const { Paragraph, Title } = Typography;

interface AuthFormValues {
  email: string;
  password: string;
  remember?: boolean;
}

interface LoginResponsePayload {
  error?: string;
  workspace?: {
    id?: string | null;
  } | null;
  runtimeSelector?: ClientRuntimeScopeSelector | null;
}

const DEFAULT_LOGIN_VALUES: AuthFormValues = {
  email: 'admin@example.com',
  password: 'Admin@123',
  remember: true,
};

const Page = styled.main`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(20px, 4vw, 32px);
  background:
    radial-gradient(circle at 22% 42%, rgba(123, 85, 232, 0.06), transparent 28%),
    linear-gradient(180deg, #f5f6fb 0%, #f2f4fa 100%);
`;

const Layout = styled.section`
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 560px) 388px;
  gap: 44px;
  justify-content: center;
  align-items: center;
  transform: translateY(-10px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    gap: 20px;
    max-width: 420px;
    transform: none;
  }
`;

const Intro = styled.div`
  max-width: 680px;

  @media (max-width: 980px) {
    max-width: none;
    text-align: center;
  }
`;

const IntroBody = styled.div`
  width: min(100%, 540px);
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;

  @media (max-width: 980px) {
    justify-content: center;
    margin-bottom: 16px;
  }
`;

const BrandMark = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 10px 22px rgba(79, 131, 255, 0.18));
`;

const BrandTitle = styled.div`
  color: #1f2638;
  font-size: 27px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
`;

const IntroTitle = styled(Title)`
  &.ant-typography {
    margin: 0 0 12px;
    color: #151d31;
    font-size: 40px;
    line-height: 1.18;
    letter-spacing: -0.02em;
    max-width: 540px;
    text-wrap: balance;
  }

  @media (max-width: 980px) {
    &.ant-typography {
      margin-bottom: 10px;
      font-size: 32px;
      max-width: none;
    }
  }
`;

const IntroCopy = styled(Paragraph)`
  &.ant-typography {
    margin: 0;
    color: #626b84;
    font-size: 15px;
    line-height: 1.75;
    max-width: 500px;
  }

  @media (max-width: 980px) {
    &.ant-typography {
      margin: 0 auto;
      font-size: 14px;
      max-width: 340px;
    }
  }
`;

const IntroTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
  max-width: 540px;

  @media (max-width: 980px) {
    justify-content: center;
    margin-top: 16px;
    max-width: none;
  }
`;

const IntroTag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(123, 85, 232, 0.12);
  background: rgba(123, 85, 232, 0.05);
  color: #665d87;
  font-size: 11px;
  line-height: 1;
`;

const LoginCard = styled.div`
  background: #ffffff;
  border-radius: 18px;
  padding: 30px;
  border: 1px solid #e6e8ee;
  box-shadow: 0 18px 40px rgba(17, 24, 39, 0.065);

  @media (max-width: 980px) {
    padding: 26px 22px 22px;
  }
`;

const CardHeader = styled.div`
  margin-bottom: 20px;
`;

const CardTitle = styled.div`
  color: #161d31;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.2;
`;

const CardCopy = styled.p`
  margin: 6px 0 0;
  color: #697287;
  font-size: 13px;
  line-height: 1.6;
`;

const StyledForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 12px;
  }

  .ant-form-item-label {
    padding-bottom: 6px;
  }

  .ant-form-item-label > label {
    color: #58607a;
    font-size: 13px;
    font-weight: 600;
  }

  .ant-input,
  .ant-input-affix-wrapper {
    height: 50px;
    border-radius: 12px;
    border-color: #dfe3eb;
    background: #fbfcfe;
    box-shadow: none;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease;
  }

  .ant-input {
    padding: 0 14px;
  }

  .ant-input-affix-wrapper {
    padding: 0 14px;
  }

  .ant-select-selector {
    min-height: 48px !important;
    border-radius: 10px !important;
    border-color: #dfe3eb !important;
    box-shadow: none !important;
    padding: 0 14px !important;
    display: flex;
    align-items: center;
  }

  .ant-select-selection-search-input,
  .ant-select-selection-item,
  .ant-select-selection-placeholder {
    line-height: 46px !important;
  }

  .ant-input-affix-wrapper > input.ant-input {
    height: 100%;
    padding: 0;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  .ant-input-affix-wrapper .ant-input-password-icon {
    color: #99a1b3;
  }

  .ant-input::placeholder,
  .ant-input-affix-wrapper input::placeholder {
    color: #a1a9bb;
  }

  .ant-input:hover,
  .ant-input-affix-wrapper:hover {
    border-color: #cfd6e6;
    background: #ffffff;
  }

  .ant-input:focus,
  .ant-input-focused,
  .ant-select-focused .ant-select-selector,
  .ant-input-affix-wrapper-focused,
  .ant-input-affix-wrapper:focus-within {
    border-color: #7b55e8;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(123, 85, 232, 0.1);
  }
`;

const SubmitButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 48px;
    margin-top: 16px;
    border: none;
    border-radius: 14px;
    background: #7b55e8;
    color: #fff;
    font-weight: 700;
    font-size: 16px;
    box-shadow: 0 12px 24px rgba(123, 85, 232, 0.24);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease;
  }

  &.ant-btn > span {
    letter-spacing: 0.02em;
  }

  &.ant-btn.ant-btn-two-chinese-chars > span {
    margin-right: 0;
    letter-spacing: 0.02em;
  }

  &.ant-btn:hover,
  &.ant-btn:focus {
    background: #6f4ce6;
    color: #fff;
    transform: translateY(-1px);
    box-shadow: 0 16px 26px rgba(123, 85, 232, 0.26);
  }

  &.ant-btn:active {
    background: #6542d8;
    color: #fff;
    transform: translateY(0);
  }
`;

const RememberRow = styled.div`
  margin-top: -2px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #5f6880;

  .remember-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  @media (max-width: 980px) {
    margin-bottom: 8px;
  }
`;

const SecondaryTextButton = styled.button`
  padding: 0;
  border: none;
  background: transparent;
  color: #6e778f;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  transition: color 0.18s ease;

  &:hover {
    color: #5942d8;
  }

  &:disabled {
    color: #9aa3b6;
    cursor: not-allowed;
  }
`;

export const resolveAuthRedirectPath = (
  session: AuthSessionPayload | null,
  redirectTo?: string | null,
): string => {
  if (!session?.authenticated) {
    return Path.Auth;
  }

  const runtimeSelector = session.runtimeSelector as
    | ClientRuntimeScopeSelector
    | undefined;

  if (runtimeSelector?.workspaceId) {
    return resolvePostAuthRedirectPath({
      redirectTo,
      runtimeSelector,
      fallbackPath: buildRuntimeScopeUrl(Path.Home, {}, runtimeSelector),
    });
  }

  return resolvePostAuthRedirectPath({
    redirectTo,
    fallbackPath: Path.OnboardingConnection,
  });
};

export const resolveLoginSuccessRedirectPath = (
  payload: LoginResponsePayload | null | undefined,
  redirectTo?: string | null,
): string => {
  const runtimeSelector =
    payload?.runtimeSelector && payload.runtimeSelector.workspaceId
      ? payload.runtimeSelector
      : payload?.workspace?.id
        ? {
            workspaceId: payload.workspace.id,
          }
        : null;

  if (runtimeSelector) {
    return resolvePostAuthRedirectPath({
      redirectTo,
      runtimeSelector,
      fallbackPath: buildRuntimeScopeUrl(Path.Home, {}, runtimeSelector),
    });
  }

  return resolvePostAuthRedirectPath({
    redirectTo,
    fallbackPath: Path.OnboardingConnection,
  });
};

const extractErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : undefined;
};

const toFriendlyErrorMessage = (rawMessage: string | undefined) => {
  const normalized = `${rawMessage || ''}`.trim();
  if (!normalized) {
    return '登录失败，请稍后重试。';
  }

  if (normalized.includes('Invalid email or password')) {
    return '用户名或密码不正确，请检查后重试。';
  }

  if (normalized.includes('already exists')) {
    return '该用户名已存在，请直接登录。';
  }

  if (normalized.includes('Too many attempts for this account')) {
    return '当前账号尝试次数过多，请稍后再试。';
  }

  if (normalized.includes('Too many requests')) {
    return '请求过于频繁，请稍后再试。';
  }

  if (normalized.includes('email, password, and displayName are required')) {
    return '请完整填写用户名和密码。';
  }

  if (normalized.includes('workspaceSlug is required')) {
    return '请选择工作空间后再继续。';
  }

  return normalized;
};

export default function AuthPage() {
  const router = useRouter();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routerRedirectTo = router.query?.redirectTo;
  const redirectTo = useMemo(
    () =>
      sanitizeLocalRedirectPath(
        Array.isArray(routerRedirectTo)
          ? routerRedirectTo[0]
          : typeof routerRedirectTo === 'string'
            ? routerRedirectTo
            : null,
      ),
    [routerRedirectTo],
  );
  const redirectPath = useMemo(
    () => resolveAuthRedirectPath(authSession.data, redirectTo),
    [authSession.data, redirectTo],
  );

  useEffect(() => {
    if (!router.isReady || authSession.loading || !authSession.authenticated) {
      return;
    }

    router.replace(redirectPath).catch(() => null);
  }, [
    authSession.authenticated,
    authSession.loading,
    redirectPath,
    router,
    router.isReady,
  ]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const queryError = Array.isArray(router.query?.error)
      ? router.query.error[0]
      : router.query?.error;
    if (queryError) {
      setError(String(queryError));
    }
  }, [router.isReady, router.query?.error]);

  const submit = async (values: AuthFormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          autoBootstrap: true,
        }),
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as LoginResponsePayload;

      if (!response.ok) {
        throw new Error(payload.error || 'Authentication failed');
      }

      clearAuthSessionCache();
      const nextPath = resolveLoginSuccessRedirectPath(payload, redirectTo);
      await router.replace(nextPath);
    } catch (submitError: unknown) {
      setError(toFriendlyErrorMessage(extractErrorMessage(submitError)));
    } finally {
      setSubmitting(false);
    }
  };

  if (authSession.loading && !authSession.data) {
    return (
      <Page>
        <Spin tip="正在验证当前登录状态…" />
      </Page>
    );
  }

  if (authSession.authenticated) {
    return (
      <Page>
        <Spin tip="已检测到登录态，正在跳转…" />
      </Page>
    );
  }

  return (
    <Page>
      <Layout>
        <Intro>
          <Brand>
            <BrandMark>
              <NovaBrandMark size={36} />
            </BrandMark>
            <BrandTitle>Nova</BrandTitle>
          </Brand>
          <IntroBody>
            <IntroTitle level={1}>安全可信的数据知识库 AI 助手</IntroTitle>
            <IntroCopy>
              一个入口完成工作空间隔离、知识库治理与结构化数据问答。
            </IntroCopy>
            <IntroTags>
              <IntroTag>工作空间隔离</IntroTag>
              <IntroTag>多知识库问答</IntroTag>
              <IntroTag>分析规则治理</IntroTag>
            </IntroTags>
          </IntroBody>
        </Intro>

        <LoginCard>
          <CardHeader>
            <CardTitle>登录工作空间</CardTitle>
            <CardCopy>使用你的工作空间账号继续。</CardCopy>
          </CardHeader>

          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 14, borderRadius: 10 }}
            />
          ) : null}

          <StyledForm
            layout="vertical"
            onFinish={(values) => {
              void submit(values as AuthFormValues);
            }}
            initialValues={DEFAULT_LOGIN_VALUES}
          >
            <Form.Item
              label="用户名"
              name="email"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input autoComplete="username" placeholder="请输入用户名" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </Form.Item>
            <RememberRow>
              <div className="remember-toggle">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Switch size="small" />
                </Form.Item>
                <span>记住我</span>
              </div>
              <SecondaryTextButton
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError('暂不支持在线重置密码，请联系管理员处理。');
                }}
              >
                忘记密码？
              </SecondaryTextButton>
            </RememberRow>
            <SubmitButton
              htmlType="submit"
              loading={submitting}
              disabled={submitting}
            >
              {submitting ? '登录中…' : '登录'}
            </SubmitButton>
          </StyledForm>
        </LoginCard>
      </Layout>
    </Page>
  );
}
