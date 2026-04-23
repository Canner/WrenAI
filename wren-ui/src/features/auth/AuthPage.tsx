import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Alert, Form, Input, Spin, Switch } from 'antd';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import NovaBrandMark from '@/components/brand/NovaBrandMark';
import {
  Brand,
  BrandMark,
  BrandTitle,
  Intro,
  IntroBody,
  IntroCopy,
  IntroTag,
  IntroTags,
  IntroTitle,
  Layout,
  LoginCard,
  Page,
  RememberRow,
  SecondaryTextButton,
  StyledForm,
  SubmitButton,
} from '@/features/auth/authPageStyles';
import useAuthSession, {
  AuthSessionPayload,
  clearAuthSessionCache,
} from '@/hooks/useAuthSession';
import {
  resolvePostAuthRedirectPath,
  sanitizeLocalRedirectPath,
} from '@/utils/authRedirect';
import { Path } from '@/utils/enum';

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
        <Spin description="正在验证当前登录状态…" />
      </Page>
    );
  }

  if (authSession.authenticated) {
    return (
      <Page>
        <Spin description="已检测到登录态，正在跳转…" />
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
