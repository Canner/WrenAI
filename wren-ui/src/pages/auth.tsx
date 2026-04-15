import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  Spin,
  Switch,
  Typography,
} from 'antd';
import styled from 'styled-components';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
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
const AUTH_WORKSPACE_HISTORY_KEY = 'nova.auth.workspaceHistory';
const MAX_WORKSPACE_HISTORY = 6;
type AuthCardView = 'login' | 'workspaceSso';

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

const readWorkspaceHistory = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(AUTH_WORKSPACE_HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_WORKSPACE_HISTORY);
  } catch (_error) {
    return [];
  }
};

const persistWorkspaceHistory = (workspaceSlugs: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    AUTH_WORKSPACE_HISTORY_KEY,
    JSON.stringify(workspaceSlugs.slice(0, MAX_WORKSPACE_HISTORY)),
  );
};

const Page = styled.main`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(180deg, #f5f6fb 0%, #f2f4fa 100%);
`;

const Layout = styled.section`
  width: min(1080px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 560px) 388px;
  gap: 20px;
  justify-content: center;
  align-items: center;
  transform: translateY(-28px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    gap: 24px;
    max-width: 420px;
    transform: none;
  }
`;

const Intro = styled.div`
  max-width: 680px;

  @media (max-width: 980px) {
    display: none;
  }
`;

const IntroBody = styled.div`
  width: min(100%, 560px);
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
`;

const BrandMark = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #5f64ff 0%, #6f8cff 100%);
  color: #fff;
  font-weight: 700;
  font-size: 16px;
`;

const BrandTitle = styled.div`
  color: #1f2638;
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
`;

const IntroTitle = styled(Title)`
  &.ant-typography {
    margin: 0 0 10px;
    color: #151d31;
    font-size: 38px;
    line-height: 1.24;
    letter-spacing: -0.02em;
    max-width: 560px;
    white-space: nowrap;
  }
`;

const IntroCopy = styled(Paragraph)`
  &.ant-typography {
    margin: 0;
    color: #626b84;
    font-size: 14px;
    line-height: 1.8;
    max-width: 560px;
  }
`;

const IntroTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
  max-width: 560px;
`;

const IntroTag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid #e7eaf1;
  background: #ffffff;
  color: #6b7285;
  font-size: 11px;
  line-height: 1;
`;

const LoginCard = styled.div`
  background: #ffffff;
  border-radius: 14px;
  padding: 28px;
  border: 1px solid #e6e8ee;
  box-shadow: 0 8px 20px rgba(17, 24, 39, 0.035);
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
    height: 48px;
    border-radius: 10px;
    border-color: #dfe3eb;
    background: #ffffff;
    box-shadow: none;
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

  .ant-input:focus,
  .ant-input-focused,
  .ant-select-focused .ant-select-selector,
  .ant-input-affix-wrapper-focused,
  .ant-input-affix-wrapper:focus-within {
    border-color: #7b55e8;
    box-shadow: 0 0 0 2px rgba(123, 85, 232, 0.08);
  }
`;

const SubmitButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 46px;
    margin-top: 14px;
    border: none;
    border-radius: 12px;
    background: #7b55e8;
    color: #fff;
    font-weight: 700;
    font-size: 16px;
    box-shadow: 0 10px 20px rgba(123, 85, 232, 0.22);
  }

  &.ant-btn:hover,
  &.ant-btn:focus {
    background: #6f4ce6;
    color: #fff;
  }

  &.ant-btn:active {
    background: #6542d8;
    color: #fff;
  }
`;

const CardHeading = styled.h2`
  margin: 0;
  color: #1b2235;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
`;

const CardSubCopy = styled.p`
  margin: 8px 0 20px;
  color: #7a8398;
  font-size: 13px;
  line-height: 1.6;
`;

const RememberRow = styled.div`
  margin-top: -2px;
  margin-bottom: 4px;
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
`;

const SecondaryTextButton = styled.button`
  padding: 0;
  border: none;
  background: transparent;
  color: #6e778f;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: #5942d8;
  }
`;

const InlineDivider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 14px;
  color: #9aa3b2;
  font-size: 12px;

  &::before,
  &::after {
    content: '';
    height: 1px;
    flex: 1;
    background: #e9edf5;
  }
`;

const SecondaryButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 46px;
    border-radius: 12px;
    border-color: #dfe3eb;
    color: #47536a;
    font-weight: 600;
    background: #fff;
  }
`;

const BackLinkButton = styled.button`
  padding: 0;
  border: none;
  background: transparent;
  color: #69758d;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: #4f5a70;
  }
`;

const SsoDescription = styled.p`
  margin: 4px 0 14px;
  color: #7a8398;
  font-size: 12px;
  line-height: 1.5;
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
  const [cardView, setCardView] = useState<AuthCardView>('login');
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [workspaceHistory, setWorkspaceHistory] = useState<string[]>([]);
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

    const routerQuery = router.query || {};
    const queryWorkspaceSlug = Array.isArray(routerQuery.workspaceSlug)
      ? routerQuery.workspaceSlug[0]
      : routerQuery.workspaceSlug;
    const normalizedQueryWorkspaceSlug = queryWorkspaceSlug
      ? String(queryWorkspaceSlug).trim()
      : '';
    if (queryWorkspaceSlug) {
      setWorkspaceSlug(normalizedQueryWorkspaceSlug);
    }

    const history = readWorkspaceHistory();
    const mergedHistory = normalizedQueryWorkspaceSlug
      ? [
          normalizedQueryWorkspaceSlug,
          ...history.filter((item) => item !== normalizedQueryWorkspaceSlug),
        ].slice(0, MAX_WORKSPACE_HISTORY)
      : history;
    if (mergedHistory.length) {
      setWorkspaceHistory(mergedHistory);
      persistWorkspaceHistory(mergedHistory);
    }

    const queryError = Array.isArray(routerQuery.error)
      ? routerQuery.error[0]
      : routerQuery.error;
    if (queryError) {
      setError(String(queryError));
    }
  }, [router.isReady, router.query?.error, router.query?.workspaceSlug]);

  const addWorkspaceToHistory = (slug: string) => {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      return;
    }

    setWorkspaceHistory((current) => {
      const next = [
        normalizedSlug,
        ...current.filter((item) => item !== normalizedSlug),
      ].slice(0, MAX_WORKSPACE_HISTORY);
      persistWorkspaceHistory(next);
      return next;
    });
  };

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

  const submitWorkspaceSso = async (selectedWorkspaceSlug?: string | null) => {
    const normalizedWorkspaceSlug = (selectedWorkspaceSlug || workspaceSlug)
      .trim()
      .toLowerCase();
    if (!normalizedWorkspaceSlug) {
      setError('请选择工作空间后再继续。');
      return;
    }

    setWorkspaceSlug(normalizedWorkspaceSlug);
    addWorkspaceToHistory(normalizedWorkspaceSlug);
    setSsoSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/sso/start', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceSlug: normalizedWorkspaceSlug,
          redirectTo,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.authorizeUrl) {
        throw new Error(payload?.error || 'Enterprise SSO start failed');
      }

      window.location.assign(payload.authorizeUrl);
    } catch (ssoError: unknown) {
      setError(
        toFriendlyErrorMessage(
          extractErrorMessage(ssoError) || 'Enterprise SSO start failed',
        ),
      );
    } finally {
      setSsoSubmitting(false);
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
            <BrandMark>N</BrandMark>
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
          {cardView === 'login' ? (
            <>
              <CardHeading>登录 Nova</CardHeading>
              <CardSubCopy>使用现有账号进入你的工作空间。</CardSubCopy>

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
                  登录
                </SubmitButton>
              </StyledForm>

              <InlineDivider>或使用第三方登录</InlineDivider>
              <SecondaryButton
                type="default"
                onClick={() => {
                  setError(null);
                  setCardView('workspaceSso');
                }}
              >
                使用飞书登录
              </SecondaryButton>
            </>
          ) : (
            <>
              <BackLinkButton
                type="button"
                onClick={() => {
                  setError(null);
                  setCardView('login');
                }}
              >
                ← 返回登录
              </BackLinkButton>
              <CardHeading style={{ marginTop: 10 }}>选择工作空间</CardHeading>
              <CardSubCopy style={{ marginBottom: 12 }}>
                选择工作空间后，将自动跳转到飞书授权登录。
              </CardSubCopy>

              {error ? (
                <Alert
                  type="error"
                  showIcon
                  message={error}
                  style={{ marginBottom: 14, borderRadius: 10 }}
                />
              ) : null}

              <StyledForm layout="vertical">
                <Form.Item label="工作空间" style={{ marginBottom: 10 }}>
                  <AutoComplete
                    options={workspaceHistory.map((slug) => ({
                      label: slug,
                      value: slug,
                    }))}
                    value={workspaceSlug}
                    placeholder="请选择或输入工作空间"
                    onSelect={(value) => {
                      void submitWorkspaceSso(String(value));
                    }}
                    filterOption={(inputValue, option) =>
                      String(option?.value || '')
                        .toLowerCase()
                        .includes(inputValue.toLowerCase())
                    }
                    onInputKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitWorkspaceSso();
                      }
                    }}
                    onChange={(value) => setWorkspaceSlug(value.trim())}
                  />
                </Form.Item>
                <SecondaryButton
                  type="default"
                  loading={ssoSubmitting}
                  disabled={ssoSubmitting}
                  onClick={() => void submitWorkspaceSso()}
                >
                  继续飞书登录
                </SecondaryButton>
              </StyledForm>
              <SsoDescription>
                请输入工作空间 slug（例如 system-workspace），
                或从历史记录中选择。
              </SsoDescription>
            </>
          )}
        </LoginCard>
      </Layout>
    </Page>
  );
}
