import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChartAnswerPinModal from './ChartAnswerPinModal';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const Input = React.forwardRef(
    (
      props: React.InputHTMLAttributes<HTMLInputElement>,
      ref: React.ForwardedRef<HTMLInputElement>,
    ) => React.createElement('input', { ...props, ref }),
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
    Input,
    Modal: ({
      children,
      open,
    }: {
      children?: React.ReactNode;
      open?: boolean;
    }) => (open ? React.createElement('div', null, children) : null),
    Space: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
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
      open
      submitting={false}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );

describe('ChartAnswerPinModal', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders only the create-and-pin input flow', () => {
    const markup = renderModal();

    expect(markup).toContain('输入新看板名称，例如：本周经营复盘');
    expect(markup).toContain('新建并固定');
    expect(markup).not.toContain('固定到看板');
    expect(markup).not.toContain('搜索看板名称');
  });

  it('reflects the typed dashboard name in the input', () => {
    const useStateSpy = setStateOverrides({
      1: '本周经营复盘',
    });

    const markup = renderModal();

    expect(markup).toContain('value="本周经营复盘"');

    useStateSpy.mockRestore();
  });
});
