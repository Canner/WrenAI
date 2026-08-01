import { Button, Tag, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, MessageOutlined } from '@ant-design/icons';
import { Panel, PageState } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useContextStore } from './useContextStore';
import { ErDiagram } from './ErDiagram';
import {
  fixtureKnowledgeStatus,
  fixtureMeasures,
  fixtureModels,
  fixtureProjectName,
  fixtureProjectPath,
  fixtureRelationships,
} from './fixtures';
import type { SemanticMeasure } from './types';
import './overview.css';

function AdditivityTag({ additivity }: { additivity: SemanticMeasure['additivity'] }) {
  const additive = additivity === 'additive';
  return (
    <Tooltip title={t('context.inferredMeasureHint')}>
      <Tag
        color={additive ? brand.verified : brand.estimate}
        icon={additive ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        bordered
      >
        {additive ? t('context.additive') : t('context.nonAdditive')}
      </Tag>
    </Tooltip>
  );
}

/**
 * The Context page's default canvas view: a project identity header (name +
 * bound filesystem path, or a "not bound" hint), then a stats toolbar, then a
 * 2-column layout — the ER diagram (models + relationships) on the left, and a side
 * rail of compact panels (measures with their additive/non-additive flag,
 * relationships, knowledge status) on the right. Models/relationships have
 * no separate stacked panel of their own — they're represented by the ER
 * diagram's nodes/edges; "View impact" stays reachable by clicking a model
 * node or a measure/relationship's link, all wired to the same
 * `useContextStore.showImpact(key)`. Fixture mode (no `VITE_BFF_URL`) renders
 * the fixture semantic layer exactly as before; live mode renders whatever
 * `useContextStore.liveOverview` has fetched (loaded on mount by
 * `ContextPage`) — see `ImpactView` for why it derives its own ER data from
 * the same `liveOverview`, not the fixtures, to stay coherent with this view.
 */
export function Overview() {
  const showImpact = useContextStore((s) => s.showImpact);
  const liveOverview = useContextStore((s) => s.liveOverview);
  const overviewLoading = useContextStore((s) => s.overviewLoading);
  const overviewError = useContextStore((s) => s.overviewError);
  const loadOverview = useContextStore((s) => s.loadOverview);

  const live = isBffEnabled();

  if (live && overviewLoading && !liveOverview) {
    return <PageState status="loading" />;
  }
  if (live && overviewError && !liveOverview) {
    return (
      <PageState
        status="error"
        title={t('context.overviewErrorTitle')}
        description={overviewError}
        onRetry={loadOverview}
      />
    );
  }

  const models = live ? (liveOverview?.models ?? []) : fixtureModels;
  const relationships = live ? (liveOverview?.relationships ?? []) : fixtureRelationships;
  const measures = live ? (liveOverview?.measures ?? []) : fixtureMeasures;
  const knowledge = live ? (liveOverview?.knowledge ?? fixtureKnowledgeStatus) : fixtureKnowledgeStatus;
  const projectName = live ? (liveOverview?.projectName ?? fixtureProjectName) : fixtureProjectName;
  const projectPath = live ? (liveOverview?.projectPath ?? '') : fixtureProjectPath;

  if (models.length === 0) {
    return (
      <PageState
        status="empty"
        title={t('context.emptyTitle')}
        description={t('context.emptyDescription')}
      />
    );
  }

  return (
    <div className="genbi-mdl-wrap">
      <div className="genbi-project-identity">
        <span className="genbi-project-name">{projectName}</span>
        {projectPath ? (
          <span className="genbi-project-path">
            {t('context.projectPathLabel')}: <code>{projectPath}</code>
          </span>
        ) : (
          <span className="genbi-project-path genbi-project-path-unbound">
            {t('context.projectPathNotBound')}
          </span>
        )}
      </div>

      <div className="genbi-mdl-toolbar">
        <span className="genbi-mdl-stat">
          <b>{models.length}</b> {t('context.modelsStat')}
        </span>
        <span className="genbi-mdl-stat-sep" aria-hidden="true">
          ·
        </span>
        <span className="genbi-mdl-stat">
          <b>{relationships.length}</b> {t('context.relationshipsStat')}
        </span>
        <span className="genbi-mdl-stat-sep" aria-hidden="true">
          ·
        </span>
        <span className="genbi-mdl-stat">
          <b>{measures.length}</b> {t('context.measuresStat')}
        </span>
      </div>

      <div className="genbi-mdl-layout">
        <Panel title={t('context.overview')}>
          <ErDiagram
            models={models}
            relationships={relationships}
            onSelectModel={showImpact}
          />
        </Panel>

        <div className="genbi-mdl-side">
          <Panel title={t('context.measuresTitle')}>
            {measures.map((measure) => (
              <div key={measure.key} className="genbi-measure">
                <div className="genbi-mtxt">
                  <div className="genbi-mname">{measure.name}</div>
                  <div className="genbi-mexpr">{measure.expression}</div>
                </div>
                <div className="genbi-measure-actions">
                  <AdditivityTag additivity={measure.additivity} />
                  <Button type="link" size="small" onClick={() => showImpact(measure.key)}>
                    {t('context.viewImpact')}
                  </Button>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title={t('context.relationshipsTitle')}>
            {relationships.map((rel) => {
              const from = models.find((m) => m.key === rel.fromModel)?.name ?? rel.fromModel;
              const to = models.find((m) => m.key === rel.toModel)?.name ?? rel.toModel;
              return (
                <div key={rel.key} className="genbi-relrow">
                  <span className="genbi-relname">
                    {from} → {to} <Tag>{rel.type}</Tag>
                  </span>
                  <Button type="link" size="small" onClick={() => showImpact(rel.key)}>
                    {t('context.viewImpact')}
                  </Button>
                </div>
              );
            })}
          </Panel>

          <Panel title={t('context.knowledgeTitle')}>
            <div className="genbi-kstat">
              <div className="genbi-kstat-item">
                <div className="genbi-num">
                  {knowledge.instructionsPresent ? t('context.yes') : t('context.no')}
                </div>
                <div className="genbi-lbl">{t('context.instructionsPresent')}</div>
              </div>
              <div className="genbi-kstat-item">
                {live && knowledge.verifiedPairCount === 0 ? (
                  <Tooltip title={t('context.verifiedPairsNotTrackedHint')}>
                    <div className="genbi-num genbi-num-muted">
                      {t('context.verifiedPairsNotTracked')}
                    </div>
                  </Tooltip>
                ) : (
                  <div className="genbi-num">{knowledge.verifiedPairCount}</div>
                )}
                <div className="genbi-lbl">{t('context.verifiedPairCount')}</div>
              </div>
            </div>
          </Panel>

          <Panel title={t('context.outOfScopeTitle')}>
            <div className="genbi-outscope">
              <Tooltip title={t('context.outOfScopeHint')}>
                <Button icon={<EditOutlined />} disabled size="small" block>
                  {t('context.outOfScopeInlineEditing')}
                </Button>
              </Tooltip>
              <Tooltip title={t('context.outOfScopeHint')}>
                <Button icon={<MessageOutlined />} disabled size="small" block>
                  {t('context.outOfScopeCopilot')}
                </Button>
              </Tooltip>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
