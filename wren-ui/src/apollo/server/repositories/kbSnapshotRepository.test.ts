import { KBSnapshotRepository } from './kbSnapshotRepository';

describe('KBSnapshotRepository runtime identity cleanup', () => {
  const repository = new KBSnapshotRepository(jest.fn() as any);

  it('strips deprecated persisted project bridge fields on reads', () => {
    expect(
      (repository as any).transformFromDBData({
        id: 'snapshot-1',
        knowledge_base_id: 'kb-1',
        snapshot_key: 'snapshot-key',
        display_name: 'Snapshot 1',
        deploy_hash: 'deploy-1',
        legacy_project_id: 42,
        manifest_ref: JSON.stringify({ version: 'v1' }),
        status: 'active',
      }),
    ).toEqual({
      id: 'snapshot-1',
      knowledgeBaseId: 'kb-1',
      snapshotKey: 'snapshot-key',
      displayName: 'Snapshot 1',
      deployHash: 'deploy-1',
      manifestRef: { version: 'v1' },
      status: 'active',
    });
  });

  it('ignores bridgeProjectId on writes', () => {
    expect(
      (repository as any).transformToDBData({
        id: 'snapshot-1',
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'snapshot-key',
        displayName: 'Snapshot 1',
        deployHash: 'deploy-1',
        bridgeProjectId: 42,
        manifestRef: { version: 'v1' },
        status: 'active',
      }),
    ).toEqual({
      id: 'snapshot-1',
      knowledge_base_id: 'kb-1',
      snapshot_key: 'snapshot-key',
      display_name: 'Snapshot 1',
      deploy_hash: 'deploy-1',
      manifest_ref: JSON.stringify({ version: 'v1' }),
      status: 'active',
    });
  });
});
