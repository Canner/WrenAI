import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthPage from './auth';
import { Path } from '@/utils/enum';

const mockUseRouter = jest.fn();
const mockUseAuthSession = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
  clearAuthSessionCache: jest.fn(),
}));

const renderPage = () => renderToStaticMarkup(React.createElement(AuthPage));

describe('auth page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: false,
      data: { authenticated: false },
    });
    mockUseRouter.mockReturnValue({
      pathname: Path.Auth,
      isReady: true,
      replace: jest.fn(),
      push: jest.fn(),
    });
  });

  it('renders login mode by default', () => {
    const markup = renderPage();

    expect(markup).toContain('安全可信的数据知识库 AI 助手');
    expect(markup).toContain(
      '一个入口完成工作空间隔离、知识库治理与结构化数据问答。',
    );
    expect(markup).toContain('用户名');
    expect(markup).toContain('登录');
    expect(markup).toContain('使用飞书登录');
    expect(markup).toContain('记住我');
    expect(markup).not.toContain('显示名称');
    expect(markup).not.toContain('确认密码');
  });

  it('renders login card on /register path as unified auth entry', () => {
    mockUseRouter.mockReturnValue({
      pathname: Path.Register,
      isReady: true,
      replace: jest.fn(),
      push: jest.fn(),
    });

    const markup = renderPage();

    expect(markup).toContain('登录 Nova');
    expect(markup).toContain('使用飞书登录');
    expect(markup).not.toContain('注册并进入');
  });
});
