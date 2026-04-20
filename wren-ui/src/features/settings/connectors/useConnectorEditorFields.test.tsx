import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorEditorFields from './useConnectorEditorFields';

const mockUseWatch = jest.fn();

jest.mock('antd', () => ({
  Form: {
    useWatch: (...args: any[]) => mockUseWatch(...args),
  },
}));

describe('useConnectorEditorFields', () => {
  let currentWatchValues: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    currentWatchValues = {};
    mockUseWatch.mockImplementation((name: string) => currentWatchValues[name]);
    jest.spyOn(React, 'useEffect').mockImplementation(((effect: any) => {
      effect();
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renderHarness = ({
    editingConnector = null,
    setFieldsValue = jest.fn(),
  }: {
    editingConnector?: any;
    setFieldsValue?: jest.Mock;
  } = {}) => {
    const form = { setFieldsValue } as any;

    const Harness = () => {
      useConnectorEditorFields({
        form,
        editingConnector,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return { setFieldsValue };
  };

  it('defaults provider to postgres for new database connectors', () => {
    currentWatchValues = {
      type: 'database',
      databaseProvider: undefined,
      dbSnowflakeAuthMode: undefined,
      dbRedshiftAuthMode: undefined,
    };
    const { setFieldsValue } = renderHarness();

    expect(setFieldsValue).toHaveBeenCalledWith({
      databaseProvider: 'postgres',
    });
  });

  it('does not overwrite persisted database provider while editing', () => {
    currentWatchValues = {
      type: 'database',
      databaseProvider: undefined,
      dbSnowflakeAuthMode: undefined,
      dbRedshiftAuthMode: undefined,
    };
    const { setFieldsValue } = renderHarness({
      editingConnector: {
        id: 'connector-1',
        type: 'database',
        databaseProvider: 'mysql',
      },
    });

    expect(setFieldsValue).not.toHaveBeenCalledWith({
      databaseProvider: 'postgres',
    });
  });
});
