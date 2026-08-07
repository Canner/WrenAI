import { Deploy, DeployLogRepository } from '../deployLogRepository';

class TestDeployLogRepository extends DeployLogRepository {
  public toDBData(data: Partial<Deploy>) {
    return this.transformToDBData(data);
  }

  public fromDBData(data: any) {
    return this.transformFromDBData(data);
  }
}

describe('DeployLogRepository', () => {
  const repository = new TestDeployLogRepository({
    client: { config: { client: 'mssql' } },
  } as any);

  it('serializes manifest before writing deploy logs', () => {
    const manifest = {
      models: [{ name: 'dbo_xStageNewOrders', columns: [{ name: 'CustName' }] }],
    };

    expect(repository.toDBData({ manifest, projectId: 11 })).toEqual({
      manifest: JSON.stringify(manifest),
      project_id: 11,
    });
  });

  it('keeps string manifests unchanged and parses them after reading', () => {
    const manifest = JSON.stringify({
      models: [{ name: 'dbo_ytblRefund', columns: [{ name: 'RefundDate' }] }],
    });

    expect(repository.toDBData({ manifest } as any)).toEqual({ manifest });
    expect(repository.fromDBData({ id: 1, manifest }).manifest).toEqual(
      JSON.parse(manifest),
    );
  });
});
