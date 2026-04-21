import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChartAnswerPinPopover from './ChartAnswerPinPopover';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Button: ({
      children,
      disabled,
      onClick,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) =>
      React.createElement(
        'button',
        { disabled, onClick, type: 'button' },
        children,
      ),
    Empty: ({ description }: { description?: React.ReactNode }) =>
      React.createElement('div', null, description),
    Space: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    Spin: () => React.createElement('div', null, 'loading'),
    Tag: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    Typography: {
      Text: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('span', null, children),
    },
  };
});

describe('ChartAnswerPinPopover', () => {
  it('renders dashboard options for quick one-click pinning', () => {
    const markup = renderToStaticMarkup(
      <ChartAnswerPinPopover
        dashboardsLoading={false}
        dashboardOptions={[
          {
            id: 1,
            isDefault: true,
            name: '默认看板',
          },
          {
            id: 2,
            isDefault: false,
            name: '销售看板',
          },
        ]}
        onCreateAndPin={jest.fn()}
        onSelectDashboard={jest.fn()}
      />,
    );

    expect(markup).toContain('默认看板');
    expect(markup).toContain('销售看板');
    expect(markup).toContain('默认');
    expect(markup).toContain('新建看板并固定');
    expect(markup).not.toContain('搜索看板名称');
    expect(markup).not.toContain('缓存开启');
    expect(markup).not.toContain('固定到当前工作空间默认看板');
  });
});
