import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelForm from './ModelForm';
import { FORM_MODE } from '@/utils/enum';

const mockUseModelList = jest.fn();
const mockListConnectionTables = jest.fn();

const setModelFormStateOverrides = (
  overrides: Partial<Record<number, any>>,
) => {
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

jest.mock('@/hooks/useModelList', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseModelList(...args),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    selector: {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    },
  }),
}));

jest.mock('@/utils/modelingRest', () => ({
  listConnectionTables: (...args: any[]) => mockListConnectionTables(...args),
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
    message: {
      error: jest.fn(),
    },
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
    mockListConnectionTables.mockResolvedValue([
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
    ]);
  });

  it('groups tables by catalog and keeps legacy tables in a fallback group', () => {
    const useStateSpy = setModelFormStateOverrides({
      3: [
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
      4: false,
    });

    const markup = renderToStaticMarkup(
      React.createElement(ModelForm, {
        form,
        formMode: FORM_MODE.CREATE,
      }),
    );

    expect(markup).toContain('optgroup label="catalog_alpha"');
    expect(markup).toContain('optgroup label="catalog_beta"');
    expect(markup).toContain('optgroup label="默认 catalog"');
    expect(markup).toContain('title="catalog_alpha.public.customers"');
    expect(markup).toContain('>public.customers<');
    expect(markup).toContain('title="legacy_metrics"');
    expect(markup).toContain(
      'value="catalog_beta.sales.orders" disabled="" title="catalog_beta.sales.orders"',
    );

    useStateSpy.mockRestore();
  });
});
