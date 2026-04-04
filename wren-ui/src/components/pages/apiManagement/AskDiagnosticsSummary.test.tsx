import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AskDiagnosticsSummary from './AskDiagnosticsSummary';
import { ApiType } from '@/apollo/client/graphql/__types__';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Tag: ({ children }: any) =>
      React.createElement('span', { 'data-kind': 'tag' }, children),
    Tooltip: ({ children, title }: any) =>
      React.createElement('div', { 'data-kind': 'tooltip', title }, children),
  };
});

describe('AskDiagnosticsSummary', () => {
  it('renders ask path, compare status, shadow error type and reason preview for ask records', () => {
    const html = renderToStaticMarkup(
      React.createElement(AskDiagnosticsSummary, {
        apiType: ApiType.ASK,
        responsePayload: {
          askDiagnostics: {
            askPath: 'skill',
            shadowCompare: {
              comparable: true,
              matched: false,
              shadowErrorType: 'timeout',
              reason:
                'shadow answer diverged from primary sql result after fallback aggregation',
            },
          },
        },
      }),
    );

    expect(html).toContain('skill');
    expect(html).toContain('mismatched');
    expect(html).toContain('timeout');
    expect(html).toContain('data-kind="tooltip"');
    expect(html).toContain('shadow answer diverged from primary sql result');
    expect(html).toContain(
      'title="shadow answer diverged from primary sql result after fallback aggregation"',
    );
  });

  it('renders placeholder for non-ask records', () => {
    const html = renderToStaticMarkup(
      React.createElement(AskDiagnosticsSummary, {
        apiType: ApiType.RUN_SQL,
        responsePayload: {
          askDiagnostics: {
            askPath: 'skill',
          },
        },
      }),
    );

    expect(html).toContain('-');
    expect(html).not.toContain('skill');
  });
});
