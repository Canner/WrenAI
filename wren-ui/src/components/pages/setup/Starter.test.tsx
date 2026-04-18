import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Starter from './Starter';

let capturedButtonItems: any[] = [];

jest.mock('./utils', () => ({
  getConnectionTypes: () => [
    { label: 'PostgreSQL', value: 'POSTGRES' },
    { label: 'TiDB', value: 'TIDB' },
  ],
}));

jest.mock('@/components/pages/setup/ButtonItem', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedButtonItems.push(props);
    return React.createElement(
      'button',
      { 'data-kind': 'setup-button-item' },
      props.label,
    );
  },
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Col: ({ children }: any) => React.createElement('div', null, children),
    Row: ({ children }: any) => React.createElement('div', null, children),
    Typography: {
      Paragraph: ({ children }: any) =>
        React.createElement('p', null, children),
      Title: ({ children }: any) => React.createElement('h2', null, children),
    },
  };
});

describe('Starter', () => {
  beforeEach(() => {
    capturedButtonItems = [];
  });

  it('only exposes real connection entry points in onboarding', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Starter, {
        submitting: false,
        onNext: jest.fn(),
      }),
    );

    expect(markup).toContain('创建知识库连接');
    expect(markup).not.toContain('推荐路径');
    expect(markup).not.toContain('或者先体验内置样例数据');
    expect(markup).not.toContain('电商订单数据');
    expect(markup).not.toContain('人力资源数据');
    expect(capturedButtonItems.length).toBeGreaterThan(0);
  });
});
