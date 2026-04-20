import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChartAnswerPinModal from './ChartAnswerPinModal';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const Input = React.forwardRef(
    (
      {
        allowClear: _allowClear,
        children,
        ...props
      }: React.InputHTMLAttributes<HTMLInputElement> & {
        allowClear?: boolean;
        children?: React.ReactNode;
      },
      ref: React.ForwardedRef<HTMLInputElement>,
    ) => React.createElement('input', { ...props, ref }, children),
  );

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
    Divider: () => React.createElement('hr'),
    Empty: ({ description }: { description?: React.ReactNode }) =>
      React.createElement('div', null, description),
    Input: Object.assign(Input, {
      Search: Input,
      Group: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('div', null, children),
    }),
    Modal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) => (visible ? React.createElement('div', null, children) : null),
    Radio: Object.assign(
      ({
        children,
        value,
      }: {
        children?: React.ReactNode;
        value?: string | number;
      }) =>
        React.createElement('label', null, [
          React.createElement('input', {
            key: 'radio',
            readOnly: true,
            type: 'radio',
            value,
          }),
          children,
        ]),
      {
        Group: ({ children }: { children?: React.ReactNode }) =>
          React.createElement('div', null, children),
      },
    ),
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

const setStateOverrides = (overrides: Partial<Record<number, any>>) => {
  let callIndex = 0;
  const spy = jest.spyOn(React, 'useState' as any) as jest.SpyInstance;
  return spy.mockImplementation(((initial: any) => {
    callIndex += 1;
    if (Object.prototype.hasOwnProperty.call(overrides, callIndex)) {
      return [overrides[callIndex], jest.fn()];
    }
    return [typeof initial === 'function' ? initial() : initial, jest.fn()];
  }) as any);
};

const renderModal = () =>
  renderToStaticMarkup(
    <ChartAnswerPinModal
      createAndPinSubmitting={false}
      dashboardsLoading={false}
      dashboardOptions={[
        {
          id: 1,
          isDefault: true,
          name: '默认看板',
          cacheEnabled: false,
          scheduleFrequency: null,
        },
      ]}
      open
      pinSubmitting={false}
      pinTargetDashboardId={1}
      setPinTargetDashboardId={jest.fn()}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
      onCreateAndPin={jest.fn()}
    />,
  );

describe('ChartAnswerPinModal', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps create-and-pin form collapsed by default', () => {
    const markup = renderModal();

    expect(markup).not.toContain('输入新看板名称，例如：本周经营复盘');
    expect(markup).toContain('新建看板并固定');
  });

  it('renders create-and-pin input group when create form is open', () => {
    const useStateSpy = setStateOverrides({
      3: true,
    });

    const markup = renderModal();

    expect(markup).toContain('输入新看板名称，例如：本周经营复盘');
    expect(markup).toContain('收起');

    useStateSpy.mockRestore();
  });
});
