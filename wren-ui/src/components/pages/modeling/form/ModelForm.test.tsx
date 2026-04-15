import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelForm from './ModelForm';
import { FORM_MODE } from '@/utils/enum';

const mockUseListDataSourceTablesQuery = jest.fn();
const mockUseModelList = jest.fn();

jest.mock('@/apollo/client/graphql/dataSource.generated', () => ({
  useListDataSourceTablesQuery: (...args: any[]) =>
    mockUseListDataSourceTablesQuery(...args),
}));

jest.mock('@/hooks/useModelList', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseModelList(...args),
}));

jest.mock('@/components/PageLoading', () => ({
  Loading: ({ children }: any) => React.createElement('div', null, children),
}));

jest.mock('@/components/table/TableTransfer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-kind': 'table-transfer' }),
  defaultColumns: [],
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const Form = ({ children }: any) =>
    React.createElement('form', null, children);
  Form.Item = ({ children, label }: any) =>
    React.createElement('div', { 'data-label': label }, children);
  Form.useWatch = jest.fn().mockReturnValue(undefined);

  const Select = ({
    children,
    getPopupContainer: _getPopupContainer,
    showSearch: _showSearch,
    optionFilterProp: _optionFilterProp,
    loading: _loading,
    allowClear: _allowClear,
    ...props
  }: any) => React.createElement('select', props, children);
  Select.Option = ({ children, value, disabled, title }: any) =>
    React.createElement('option', { value, disabled, title }, children);
  Select.OptGroup = ({ children, label }: any) =>
    React.createElement('optgroup', { label }, children);

  return {
    Form,
    Select,
  };
});

describe('ModelForm', () => {
  const form = {
    resetFields: jest.fn(),
    setFieldsValue: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseModelList.mockReturnValue({
      data: [{ sourceTableName: 'catalog_beta.sales.orders' }],
      loading: false,
    });
    mockUseListDataSourceTablesQuery.mockReturnValue({
      data: {
        listDataSourceTables: [
          {
            name: 'catalog_beta.sales.orders',
            properties: {
              catalog: 'catalog_beta',
              schema: 'sales',
              table: 'orders',
            },
            columns: [],
          },
          {
            name: 'catalog_alpha.public.customers',
            properties: {
              catalog: 'catalog_alpha',
              schema: 'public',
              table: 'customers',
            },
            columns: [],
          },
          {
            name: 'legacy_metrics',
            properties: null,
            columns: [],
          },
        ],
      },
      loading: false,
    });
  });

  it('groups tables by catalog and keeps legacy tables in a fallback group', () => {
    const html = renderToStaticMarkup(
      React.createElement(ModelForm, {
        form,
        formMode: FORM_MODE.CREATE,
      }),
    );

    expect(html).toContain('optgroup label="catalog_alpha"');
    expect(html).toContain('optgroup label="catalog_beta"');
    expect(html).toContain('optgroup label="默认 catalog"');
    expect(html).toContain('title="catalog_alpha.public.customers"');
    expect(html).toContain('>public.customers<');
    expect(html).toContain('title="legacy_metrics"');
    expect(html).toContain(
      'value="catalog_beta.sales.orders" disabled="" title="catalog_beta.sales.orders"',
    );
  });
});
