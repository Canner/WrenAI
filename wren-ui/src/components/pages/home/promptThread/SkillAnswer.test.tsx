import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SkillAnswer from './SkillAnswer';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Alert: ({ message, description }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'alert' },
        message,
        description ? React.createElement('div', null, description) : null,
      ),
    Table: ({ columns = [], dataSource = [] }: any) =>
      React.createElement(
        'table',
        { 'data-kind': 'table' },
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            columns.map((column: any) =>
              React.createElement('th', { key: column.key }, column.title),
            ),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          dataSource.map((row: any, rowIndex: number) =>
            React.createElement(
              'tr',
              { key: row.__skillRowKey || rowIndex },
              columns.map((column: any) =>
                React.createElement(
                  'td',
                  { key: column.key },
                  column.render
                    ? column.render(undefined, row)
                    : row[column.dataIndex],
                ),
              ),
            ),
          ),
        ),
      ),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
      Link: ({ children, href }: any) =>
        React.createElement('a', { href }, children),
    },
  };
});

jest.mock('@/components/editor/MarkdownBlock', () => {
  const React = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ content }: { content: string }) =>
      React.createElement('div', { 'data-kind': 'markdown' }, content),
  };
});

jest.mock('@/components/chart', () => {
  const React = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ spec, values }: { spec: any; values: any[] }) =>
      React.createElement(
        'div',
        { 'data-kind': 'chart' },
        JSON.stringify({ spec, values }),
      ),
  };
});

describe('SkillAnswer', () => {
  it('renders text skill results', () => {
    const html = renderToStaticMarkup(
      React.createElement(SkillAnswer, {
        skillResult: {
          resultType: 'text',
          text: '本月 GMV 为 **128 万**',
        },
      }),
    );

    expect(html).toContain('本月 GMV 为 **128 万**');
  });

  it('renders tabular skill results', () => {
    const html = renderToStaticMarkup(
      React.createElement(SkillAnswer, {
        skillResult: {
          resultType: 'tabular_frame',
          columns: [{ name: 'city', description: '城市' }],
          rows: [{ city: '上海' }],
        },
      }),
    );

    expect(html).toContain('城市');
    expect(html).toContain('上海');
  });

  it('renders chart skill results', () => {
    const html = renderToStaticMarkup(
      React.createElement(SkillAnswer, {
        skillResult: {
          resultType: 'chart_spec',
          rows: [{ month: '2026-03', value: 128 }],
          chartSpec: {
            mark: 'bar',
            encoding: {
              x: { field: 'month', type: 'nominal' },
              y: { field: 'value', type: 'quantitative' },
            },
          },
        },
      }),
    );

    expect(html).toContain('data-kind="chart"');
    expect(html).toContain('&quot;mark&quot;:&quot;bar&quot;');
    expect(html).toContain('&quot;month&quot;:&quot;2026-03&quot;');
  });
});
