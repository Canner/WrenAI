import { Button, Tag, Tooltip } from 'antd';
import { ArrowLeftOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { Panel, KVRow, DataTable, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { SeverityTag } from './SeverityTag';
import { useContextStore } from './useContextStore';
import { ErDiagram } from './ErDiagram';
import { blastRadiusByKey, brokenPairsByKey, fixtureModels, fixtureRelationships } from './fixtures';
import type { BlastRadius, BrokenPair, ImpactNode, ImpactNodeKind, SemanticRelationship } from './types';

/**
 * `BlastRadius.downstream` for a model seed lists relationships/measures/views
 * (never other models directly) — so "which models are affected" is derived
 * by walking the seed's downstream relationships to their other-side model.
 * `relationships` must be the SAME relationship set the ER diagram itself is
 * rendering (fixtures offline, `liveOverview.relationships` live) — otherwise
 * the diagram and the highlighted "affected models" could disagree.
 */
function connectedModelKeys(blastRadius: BlastRadius, relationships: SemanticRelationship[]): string[] {
  const relationshipKeys = new Set(
    blastRadius.downstream.filter((node) => node.kind === 'relationship').map((node) => node.key),
  );
  const modelKeys = new Set<string>();
  for (const rel of relationships) {
    if (!relationshipKeys.has(rel.key)) continue;
    if (rel.fromModel !== blastRadius.seed.key) modelKeys.add(rel.fromModel);
    if (rel.toModel !== blastRadius.seed.key) modelKeys.add(rel.toModel);
  }
  return [...modelKeys];
}

const KIND_LABEL: Record<ImpactNodeKind, string> = {
  model: t('context.kindModel'),
  measure: t('context.kindMeasure'),
  relationship: t('context.kindRelationship'),
  view: t('context.kindView'),
};

const KIND_ORDER: ImpactNodeKind[] = ['model', 'relationship', 'measure', 'view'];

function groupByKind(downstream: ImpactNode[]): { kind: ImpactNodeKind; count: number }[] {
  const counts = new Map<ImpactNodeKind, number>();
  for (const node of downstream) {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  }
  return KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind)!,
  }));
}

/** Downstream node name by key, for resolving a broken pair's `hitDownstreamKeys` to a readable label. */
function downstreamNameByKey(downstream: ImpactNode[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const node of downstream) names[node.key] = node.name;
  return names;
}

/**
 * Read-only "depended-on-by" view for a selected entity: its downstream
 * dependents grouped by kind, and the worst-case severity of changing it.
 * Phase 1 stops here — deploy-time blast-radius review is a disabled
 * placeholder (see the out-of-scope panel on the Context page).
 */
export function ImpactView() {
  const impactSeedKey = useContextStore((s) => s.impactSeedKey);
  const showOverview = useContextStore((s) => s.showOverview);
  const showImpact = useContextStore((s) => s.showImpact);
  const liveImpactByKey = useContextStore((s) => s.liveImpactByKey);
  const impactError = useContextStore((s) => s.impactError);
  const liveOverview = useContextStore((s) => s.liveOverview);

  const live = isBffEnabled();
  // Same models/relationships the ER diagram renders in `Overview` — sourced
  // from `liveOverview` live, fixtures offline — so the ER embedded below and
  // its "affected models" highlight never mix a fixture layer with live data.
  const erModels = live ? (liveOverview?.models ?? []) : fixtureModels;
  const erRelationships = live ? (liveOverview?.relationships ?? []) : fixtureRelationships;
  const liveImpactData = impactSeedKey ? liveImpactByKey[impactSeedKey] : undefined;
  const blastRadius = impactSeedKey
    ? live
      ? liveImpactData?.blastRadius
      : blastRadiusByKey[impactSeedKey]
    : undefined;
  const brokenPairs: BrokenPair[] = impactSeedKey
    ? live
      ? (liveImpactData?.brokenPairs ?? [])
      : (brokenPairsByKey[impactSeedKey] ?? [])
    : [];

  if (!impactSeedKey) {
    return <PageState status="empty" title={t('context.emptyTitle')} />;
  }

  if (live && impactError) {
    return (
      <PageState
        status="error"
        title={t('context.impactErrorTitle')}
        description={impactError}
        onRetry={() => showImpact(impactSeedKey)}
      />
    );
  }

  if (!blastRadius) {
    return <PageState status={live ? 'loading' : 'empty'} title={t(live ? 'context.impactLoadingTitle' : 'context.emptyTitle')} />;
  }

  const grouped = groupByKind(blastRadius.downstream);
  const downstreamNames = downstreamNameByKey(blastRadius.downstream);

  return (
    <Panel title={t('context.impactTitle')}>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={showOverview}
        style={{ paddingLeft: 0, marginBottom: 8 }}
      >
        {t('context.backToOverview')}
      </Button>

      <KVRow
        label={t('context.impactSeed')}
        value={
          <>
            {blastRadius.seed.name}{' '}
            <Tag>{KIND_LABEL[blastRadius.seed.kind]}</Tag>
          </>
        }
      />
      <KVRow label={t('context.impactSeverity')} value={<SeverityTag severity={blastRadius.severity} />} />

      {blastRadius.seed.kind === 'model' && (
        <div style={{ marginTop: 16, overflowX: 'auto' }}>
          <ErDiagram
            models={erModels}
            relationships={erRelationships}
            impact={{ selectedKey: blastRadius.seed.key, affectedKeys: connectedModelKeys(blastRadius, erRelationships) }}
          />
        </div>
      )}

      <div style={{ marginTop: 16, fontWeight: 500 }}>{t('context.downstreamByKind')}</div>
      {grouped.length === 0 ? (
        <div style={{ opacity: 0.65, padding: '8px 0' }}>{t('context.noDownstream')}</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {grouped.map(({ kind, count }) => (
            <Tag key={kind}>
              {KIND_LABEL[kind]}: {count}
            </Tag>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, fontWeight: 500 }}>{t('context.downstreamDependents')}</div>
      <DataTable<ImpactNode>
        rowKey="key"
        dataSource={blastRadius.downstream}
        columns={[
          { title: 'Name', dataIndex: 'name', key: 'name' },
          {
            title: 'Kind',
            dataIndex: 'kind',
            key: 'kind',
            render: (kind: ImpactNodeKind) => <Tag>{KIND_LABEL[kind]}</Tag>,
          },
        ]}
      />

      <div style={{ marginTop: 16, fontWeight: 500 }}>{t('context.brokenPairsTitle')}</div>
      {brokenPairs.length === 0 ? (
        <div style={{ opacity: 0.65, padding: '8px 0' }}>{t('context.noBrokenPairs')}</div>
      ) : (
        <DataTable<BrokenPair>
          rowKey="question"
          dataSource={brokenPairs}
          columns={[
            { title: t('context.brokenPairsQuestion'), dataIndex: 'question', key: 'question' },
            {
              title: t('context.brokenPairsHits'),
              dataIndex: 'hitDownstreamKeys',
              key: 'hitDownstreamKeys',
              render: (hitDownstreamKeys: string[]) => (
                <>
                  {hitDownstreamKeys.map((key) => (
                    <Tag key={key}>{downstreamNames[key] ?? key}</Tag>
                  ))}
                </>
              ),
            },
          ]}
        />
      )}

      <Tooltip title={t('context.outOfScopeHint')}>
        <Button icon={<CloudUploadOutlined />} disabled style={{ marginTop: 16 }}>
          {t('context.outOfScopeDeployReview')}
        </Button>
      </Tooltip>
    </Panel>
  );
}
