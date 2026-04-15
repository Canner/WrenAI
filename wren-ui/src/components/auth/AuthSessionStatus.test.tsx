import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthSessionStatus from './AuthSessionStatus';

jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    Spin: () => React.createElement('span', { 'data-kind': 'spin' }, 'loading'),
    Tag: ({ children }: any) =>
      React.createElement('span', { 'data-kind': 'tag' }, children),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
    },
  };
});

const mockedUseAuthSession = jest.requireMock('@/hooks/useAuthSession')
  .default as jest.Mock;

describe('AuthSessionStatus', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
  });

  it('renders authenticated identity and role', () => {
    mockedUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: true,
      data: {
        user: {
          email: 'owner@example.com',
          displayName: 'Owner',
        },
        workspace: {
          id: 'workspace-1',
          name: 'Demo Workspace',
        },
        membership: {
          id: 'member-1',
          roleKey: 'owner',
        },
      },
    });

    const html = renderToStaticMarkup(<AuthSessionStatus variant="card" />);

    expect(html).toContain('演示管理员');
    expect(html).toContain('演示工作区');
    expect(html).toContain('所有者');
    expect(html).toContain('退出');
  });

  it('renders login action when unauthenticated', () => {
    mockedUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: false,
      data: {
        authenticated: false,
      },
    });

    const html = renderToStaticMarkup(<AuthSessionStatus />);

    expect(html).toContain('去登录');
  });
});
