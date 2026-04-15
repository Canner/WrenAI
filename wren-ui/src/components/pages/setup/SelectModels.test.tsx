import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SelectModels from './SelectModels';

let capturedMultiSelectBoxProps: any;

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) =>
    React.createElement('a', { href }, children),
}));

jest.mock('@/components/table/MultiSelectBox', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedMultiSelectBoxProps = props;
    return React.createElement('div', { 'data-kind': 'multi-select-box' });
  },
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const Form = ({ children }: any) =>
    React.createElement('form', null, children);
  Form.Item = ({ children }: any) => React.createElement('div', null, children);
  Form.useForm = () => [
    {
      validateFields: jest.fn().mockResolvedValue({ tables: [] }),
    },
  ];

  return {
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    Form,
    Space: ({ children }: any) => React.createElement('div', null, children),
    Typography: {
      Paragraph: ({ children }: any) =>
        React.createElement('p', null, children),
      Text: ({ children }: any) => React.createElement('span', null, children),
      Title: ({ children }: any) => React.createElement('h2', null, children),
    },
  };
});

describe('SelectModels', () => {
  beforeEach(() => {
    capturedMultiSelectBoxProps = undefined;
  });

  it('shows catalog and schema columns for multi-source table selection', () => {
    renderToStaticMarkup(
      React.createElement(SelectModels, {
        fetching: false,
        submitting: false,
        onBack: jest.fn(),
        onNext: jest.fn(),
        tables: [
          {
            name: 'catalog_b.sales.orders',
            properties: {
              catalog: 'catalog_b',
              schema: 'sales',
              table: 'orders',
            },
            columns: [],
          },
          {
            name: 'catalog_a.public.customers',
            properties: {
              catalog: 'catalog_a',
              schema: 'public',
              table: 'customers',
            },
            columns: [],
          },
        ],
      }),
    );

    expect(
      capturedMultiSelectBoxProps.columns.map((column: any) => column.title),
    ).toEqual(['Catalog', 'Schema', '数据表']);
    expect(
      capturedMultiSelectBoxProps.items.map((item: any) => item.qualifiedName),
    ).toEqual(['catalog_a.public.customers', 'catalog_b.sales.orders']);
    expect(capturedMultiSelectBoxProps.items[0]).toMatchObject({
      value: 'catalog_a.public.customers',
      catalogLabel: 'catalog_a',
      schemaLabel: 'public',
      tableLabel: 'customers',
    });
  });
});
