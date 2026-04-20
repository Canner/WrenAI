import {
  buildModelMetadataPayload,
  persistConnectorAssetDrafts,
  resolvePersistableConnectorFieldNames,
  resolvePersistableConnectorTableName,
} from './knowledgeAssetWizardPersistence';

const mockCreateModel = jest.fn();
const mockUpdateModelMetadata = jest.fn();
const mockDeployCurrentRuntime = jest.fn();
const mockFetch = jest.fn();

jest.mock('@/utils/modelingRest', () => ({
  __esModule: true,
  createModel: (...args: any[]) => mockCreateModel(...args),
  deployCurrentRuntime: (...args: any[]) => mockDeployCurrentRuntime(...args),
  updateModelMetadata: (...args: any[]) => mockUpdateModelMetadata(...args),
}));

describe('knowledgeAssetWizardPersistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as any;
    mockDeployCurrentRuntime.mockResolvedValue({
      status: 'SUCCESS',
    });
  });

  it('prefers connector table name when resolving persistence table identity', () => {
    expect(
      resolvePersistableConnectorTableName({
        connectorTableName: 'orders',
        fields: [],
        sourceTableName: 'sales.orders',
        name: '订单',
      }),
    ).toBe('orders');
  });

  it('filters calculated fields and deduplicates persisted field names', () => {
    expect(
      resolvePersistableConnectorFieldNames({
        fields: [
          { fieldName: 'order_id' },
          { fieldName: 'order_id' },
          { fieldName: 'amount', isCalculated: true },
        ],
        name: '订单',
      }),
    ).toEqual(['order_id']);
  });

  it('builds metadata payload with empty collections', () => {
    expect(
      buildModelMetadataPayload({
        description: '描述',
        fields: [],
        name: '订单',
      }),
    ).toEqual({
      calculatedFields: [],
      columns: [],
      description: '描述',
      displayName: '订单',
      nestedColumns: [],
      relationships: [],
    });
  });

  it('creates models, updates metadata, and refetches diagram', async () => {
    mockCreateModel
      .mockResolvedValueOnce({ id: 11 })
      .mockResolvedValueOnce({ id: 12 });
    mockUpdateModelMetadata.mockResolvedValue({ success: true });
    const refetchDiagram = jest.fn().mockResolvedValue({ diagram: {} });

    const result = await persistConnectorAssetDrafts({
      assetDraftPreviews: [
        {
          connectorTableName: 'orders',
          description: '订单模型',
          fields: [{ fieldName: 'order_id' }, { fieldName: 'amount' }],
          name: '业务订单',
          primaryKey: 'order_id',
          sourceTableName: 'sales.orders',
        },
        {
          connectorTableName: 'customers',
          description: '客户模型',
          fields: [{ fieldName: 'customer_id' }],
          name: '业务客户',
          primaryKey: 'customer_id',
          sourceTableName: 'sales.customers',
        },
      ],
      refetchDiagram,
      selector: {
        deployHash: 'deploy-1',
        kbSnapshotId: 'snapshot-1',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
      },
    });

    expect(mockCreateModel).toHaveBeenNthCalledWith(1, expect.any(Object), {
      connectorId: null,
      fields: ['order_id', 'amount'],
      primaryKey: 'order_id',
      sourceTableName: 'orders',
    });
    expect(mockUpdateModelMetadata).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      11,
      expect.objectContaining({
        description: '订单模型',
        displayName: '业务订单',
      }),
    );
    expect(mockDeployCurrentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        deployHash: 'deploy-1',
        kbSnapshotId: 'snapshot-1',
      }),
    );
    expect(refetchDiagram).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it('activates connector runtime before persisting multi-table imports', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        connectorId: 'runtime-connector-1',
        projectId: 77,
        selector: {
          deployHash: 'deploy-2',
          kbSnapshotId: 'snapshot-2',
          knowledgeBaseId: 'kb-1',
          workspaceId: 'ws-1',
        },
      }),
    });
    mockDeployCurrentRuntime.mockResolvedValue({
      status: 'SUCCESS',
      selector: {
        deployHash: 'deploy-3',
        kbSnapshotId: 'snapshot-3',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
      },
    });
    mockCreateModel.mockResolvedValue({ id: 21 });
    mockUpdateModelMetadata.mockResolvedValue({ success: true });
    const refetchDiagram = jest.fn().mockResolvedValue({ diagram: {} });
    const refetchRuntimeSelector = jest.fn().mockResolvedValue({});
    const replaceRuntimeScope = jest.fn().mockResolvedValue(true);

    await persistConnectorAssetDrafts({
      assetDraftPreviews: [
        {
          connectorTableName: 'report_demo.dwd_order_task',
          description: '订单任务模型',
          fields: [{ fieldName: 'id' }, { fieldName: 'order_no' }],
          name: '验证订单任务',
          primaryKey: 'id',
          sourceTableName: 'report_demo.dwd_order_task',
        },
      ],
      connectorId: 'workspace-connector-1',
      refetchDiagram,
      refetchRuntimeSelector,
      replaceRuntimeScope,
      selector: {
        deployHash: 'deploy-1',
        kbSnapshotId: 'snapshot-1',
        knowledgeBaseId: 'kb-1',
        workspaceId: 'ws-1',
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain(
      '/api/v1/connectors/workspace-connector-1/activate',
    );
    expect(replaceRuntimeScope).toHaveBeenCalledWith({
      deployHash: 'deploy-2',
      kbSnapshotId: 'snapshot-2',
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
    });
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({
        deployHash: 'deploy-2',
        kbSnapshotId: 'snapshot-2',
      }),
      expect.objectContaining({
        connectorId: 'workspace-connector-1',
        sourceTableName: 'report_demo.dwd_order_task',
      }),
    );
    expect(mockDeployCurrentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        deployHash: 'deploy-2',
        kbSnapshotId: 'snapshot-2',
      }),
    );
    expect(replaceRuntimeScope).toHaveBeenLastCalledWith({
      deployHash: 'deploy-3',
      kbSnapshotId: 'snapshot-3',
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
    });
    expect(refetchDiagram).not.toHaveBeenCalled();
    expect(refetchRuntimeSelector).toHaveBeenCalledTimes(1);
  });

  it('surfaces deploy failures after persisting assets', async () => {
    mockCreateModel.mockResolvedValue({ id: 31 });
    mockUpdateModelMetadata.mockResolvedValue({ success: true });
    mockDeployCurrentRuntime.mockResolvedValue({
      status: 'FAILED',
      error: 'deploy failed',
    });

    await expect(
      persistConnectorAssetDrafts({
        assetDraftPreviews: [
          {
            connectorTableName: 'orders',
            description: '订单模型',
            fields: [{ fieldName: 'order_id' }],
            name: '业务订单',
            primaryKey: 'order_id',
            sourceTableName: 'sales.orders',
          },
        ],
        refetchDiagram: jest.fn().mockResolvedValue({}),
        selector: {
          deployHash: 'deploy-1',
          kbSnapshotId: 'snapshot-1',
          knowledgeBaseId: 'kb-1',
          workspaceId: 'ws-1',
        },
      }),
    ).rejects.toThrow('deploy failed');
  });
});
