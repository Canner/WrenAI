import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useManageConnectorsEditorState from './useManageConnectorsEditorState';

const mockUseForm = jest.fn();
const mockUseConnectorEditorFields = jest.fn();
const mockUseConnectorEditorModalState = jest.fn();

jest.mock('antd', () => ({
  Form: {
    useForm: (...args: any[]) => mockUseForm(...args),
  },
}));

jest.mock('./useConnectorEditorFields', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseConnectorEditorFields(...args),
}));

jest.mock('./useConnectorEditorModalState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseConnectorEditorModalState(...args),
}));

describe('useManageConnectorsEditorState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseForm.mockReturnValue([
      {
        getFieldsValue: jest.fn(),
        resetFields: jest.fn(),
        setFieldsValue: jest.fn(),
        validateFields: jest.fn(),
      },
    ]);
    mockUseConnectorEditorFields.mockReturnValue({
      watchedConnectorType: 'database',
      watchedDatabaseProvider: 'postgres',
      watchedSnowflakeAuthMode: 'password',
      watchedRedshiftAuthMode: 'redshift',
      databaseProviderExample: {
        config: '{"host":"127.0.0.1"}',
        secret: '{"password":"postgres"}',
      },
    });
    mockUseConnectorEditorModalState.mockReturnValue({
      modalOpen: false,
      editingConnector: null,
      clearSecretChecked: false,
      openCreateModal: jest.fn(),
      openEditModal: jest.fn(),
      closeModal: jest.fn(),
      setClearSecretChecked: jest.fn(),
    });
  });

  const renderHarness = (): ReturnType<
    typeof useManageConnectorsEditorState
  > => {
    let current: ReturnType<typeof useManageConnectorsEditorState> | null =
      null;

    const Harness = () => {
      current = useManageConnectorsEditorState({
        createConnectorBlockedReason: null,
        updateConnectorBlockedReason: null,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useManageConnectorsEditorState');
    }

    return current as ReturnType<typeof useManageConnectorsEditorState>;
  };

  it('creates a shared form instance and passes it to field/modal hooks', () => {
    const hookValue = renderHarness();

    expect(mockUseConnectorEditorFields).toHaveBeenCalledWith(
      expect.objectContaining({
        form: hookValue.form,
        editingConnector: null,
      }),
    );
    expect(mockUseConnectorEditorModalState).toHaveBeenCalledWith(
      expect.objectContaining({
        form: hookValue.form,
        createConnectorBlockedReason: null,
        updateConnectorBlockedReason: null,
      }),
    );
    expect(hookValue.watchedConnectorType).toBe('database');
    expect(hookValue.modalOpen).toBe(false);
  });
});
