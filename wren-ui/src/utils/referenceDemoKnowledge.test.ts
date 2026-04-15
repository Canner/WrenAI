import {
  DEFAULT_REFERENCE_DEMO_KNOWLEDGE,
  getReferenceAssetCountByKnowledgeName,
  getReferenceDisplayAssetName,
  getReferenceDemoKnowledgeByName,
  getReferenceDisplayKnowledgeName,
  getReferenceDisplaySnapshotName,
  getReferenceDisplayWorkspaceName,
} from './referenceDemoKnowledge';

describe('referenceDemoKnowledge', () => {
  it('maps legacy github demo names to the default sample knowledge', () => {
    expect(getReferenceDemoKnowledgeByName('Github数据')?.name).toBe(
      DEFAULT_REFERENCE_DEMO_KNOWLEDGE.name,
    );
  });

  it('matches hr style names', () => {
    expect(
      getReferenceDemoKnowledgeByName('人力资源数据（HR）')?.assetName,
    ).toBe('员工人事主题视图');
  });

  it('falls back to the raw knowledge name when no alias matches', () => {
    expect(getReferenceDisplayKnowledgeName('自定义业务知识库')).toBe(
      '自定义业务知识库',
    );
  });

  it('maps demo workspace and snapshot names to localized labels', () => {
    expect(getReferenceDisplayWorkspaceName('Demo Workspace')).toBe(
      '演示工作区',
    );
    expect(getReferenceDisplaySnapshotName('Local Main')).toBe('主线快照');
  });

  it('maps sample ecommerce asset names to localized labels', () => {
    expect(
      getReferenceDisplayAssetName('电商订单数据（E-commerce）', 'orders'),
    ).toBe('订单信息');
  });

  it('returns stable asset counts for music and nba sample knowledge bases', () => {
    expect(getReferenceAssetCountByKnowledgeName('MUSIC')).toBe(7);
    expect(getReferenceAssetCountByKnowledgeName('NBA')).toBe(5);
  });
});
