import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DetailsDrawer from './DetailsDrawer';
import { ApiType } from '@/types/apiHistory';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Drawer: ({ children, title }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'drawer' },
        title ? React.createElement('h3', null, title) : null,
        children,
      ),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
    },
    Row: ({ children }: any) => React.createElement('div', null, children),
    Col: ({ children }: any) => React.createElement('div', null, children),
    Tag: ({ children }: any) =>
      React.createElement('span', { 'data-kind': 'tag' }, children),
  };
});

jest.mock('@ant-design/icons/CheckCircleOutlined', () => () => 'check-icon');
jest.mock('@ant-design/icons/CloseCircleOutlined', () => () => 'close-icon');

jest.mock('@/components/code/JsonCodeBlock', () => {
  const React = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ code }: { code: any }) =>
      React.createElement('pre', { 'data-kind': 'json' }, JSON.stringify(code)),
  };
});

jest.mock('@/utils/time', () => ({
  getAbsoluteTime: (value: string) => value,
}));

describe('DetailsDrawer', () => {
  it('renders ask diagnostics and shadow compare details in a structured section', () => {
    const html = renderToStaticMarkup(
      React.createElement(DetailsDrawer, {
        visible: true,
        onClose: jest.fn(),
        defaultValue: {
          id: 'history-1',
          projectId: 1,
          apiType: ApiType.ASK,
          threadId: 'thread-1',
          headers: {},
          requestPayload: { question: '本月 GMV' },
          responsePayload: {
            askDiagnostics: {
              traceId: 'trace-1',
              askPath: 'instructions',
              shadowCompare: {
                enabled: true,
                executed: true,
                comparable: true,
                matched: false,
                primaryAskPath: 'instructions',
                shadowAskPath: 'nl2sql',
                primaryType: 'TEXT_TO_SQL',
                shadowType: 'TEXT_TO_SQL',
                primaryResultCount: 1,
                shadowResultCount: 0,
                shadowErrorType: 'timeout',
                reason: 'result mismatch',
                shadowError: 'legacy timeout',
              },
            },
          },
          statusCode: 200,
          durationMs: 128,
          createdAt: '2026-04-03T00:00:00.000Z',
          updatedAt: '2026-04-03T00:00:00.000Z',
        },
      } as any),
    );

    expect(html).toContain('问答诊断');
    expect(html).toContain('trace-1');
    expect(html).toContain('instructions');
    expect(html).toContain('影子对比');
    expect(html).toContain('不匹配');
    expect(html).toContain('nl2sql');
    expect(html).toContain('TEXT_TO_SQL');
    expect(html).toContain('timeout');
    expect(html).toContain('result mismatch');
    expect(html).toContain('legacy timeout');
  });
});
