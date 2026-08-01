import { Tooltip } from 'antd';
import { TableOutlined } from '@ant-design/icons';
import { t } from '@/i18n/strings';
import { computeErLayout } from './erLayout';
import './erDiagram.css';
import type { RelationshipType, SemanticModel, SemanticRelationship } from './types';

const NODE_WIDTH = 200;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 26;
const PAD = 20;

function cardinalityLabel(type: RelationshipType): string {
  switch (type) {
    case 'one-to-one':
      return '1:1';
    case 'one-to-many':
      return '1:N';
    case 'many-to-one':
      return 'N:1';
    case 'many-to-many':
      return 'N:N';
  }
}

/** A model's rendered card size, driven purely by its column count. */
function nodeHeight(model: SemanticModel): number {
  return HEADER_HEIGHT + model.columns.length * ROW_HEIGHT;
}

export interface ErDiagramImpact {
  /** Model highlighted as the change source (accent outline, active edges). */
  selectedKey: string;
  /** Models highlighted as directly affected by the change (warn outline). */
  affectedKeys: string[];
}

interface ErDiagramProps {
  models: SemanticModel[];
  relationships: SemanticRelationship[];
  /** When set, overlays blast-radius styling driven by the caller's impact data. */
  impact?: ErDiagramImpact;
  /** When set, model nodes become clickable (e.g. Overview wiring "view impact" to a node click). */
  onSelectModel?: (key: string) => void;
}

/**
 * Context Overview's ER diagram: a dotted-grid canvas with model nodes
 * rendered as cards (header + mono column rows with PK/FK key pills) and SVG
 * edges between related models — mirrors the design-system reference
 * mockup's `.canvas-er`/`.mnode`/`.er-edges` markup. Read-only; driven
 * entirely by `models`/`relationships`/`impact` (fixture data upstream).
 */
export function ErDiagram({ models, relationships, impact, onSelectModel }: ErDiagramProps) {
  if (models.length === 0) return null;

  // Live/real data has no `position` (see `SemanticModel.position`) — compute
  // one deterministically from the relationship graph. Only models actually
  // missing a position pay for this; fixture data (which supplies `position`
  // on every model) never triggers it.
  const computedPositions = models.some((model) => !model.position)
    ? computeErLayout(
        models.map((model) => ({ key: model.key, height: nodeHeight(model) })),
        relationships,
        { nodeWidth: NODE_WIDTH },
      )
    : undefined;

  const rectByKey = new Map(
    models.map((model) => {
      const position = model.position ?? computedPositions?.get(model.key) ?? { x: 0, y: 0 };
      return [
        model.key,
        { x: position.x + PAD, y: position.y + PAD, width: NODE_WIDTH, height: nodeHeight(model) },
      ] as const;
    }),
  );
  const canvasWidth = Math.max(...[...rectByKey.values()].map((r) => r.x + r.width)) + PAD;
  const canvasHeight = Math.max(...[...rectByKey.values()].map((r) => r.y + r.height)) + PAD;

  return (
    <div className="genbi-canvas-er">
      <div className="genbi-er-inner" style={{ width: canvasWidth, height: canvasHeight }}>
        <svg
          className={`genbi-er-edges${impact ? ' is-impact' : ''}`}
          role="img"
          aria-label={t('context.erDiagramAriaLabel')}
          width={canvasWidth}
          height={canvasHeight}
        >
          {relationships.map((rel) => {
            const from = rectByKey.get(rel.fromModel);
            const to = rectByKey.get(rel.toModel);
            if (!from || !to) return null;

            const x1 = from.x + from.width;
            const y1 = from.y + from.height / 2;
            const x2 = to.x;
            const y2 = to.y + to.height / 2;
            const midX = (x1 + x2) / 2;
            const active =
              !!impact &&
              ((rel.fromModel === impact.selectedKey && impact.affectedKeys.includes(rel.toModel)) ||
                (rel.toModel === impact.selectedKey && impact.affectedKeys.includes(rel.fromModel)));
            const activeClass = active ? 'is-active' : undefined;

            return (
              <g key={rel.key} data-testid={`er-edge-${rel.key}`}>
                <path className={activeClass} d={`M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`} />
                <circle className={activeClass} cx={x1} cy={y1} r={3} />
                <circle className={activeClass} cx={x2} cy={y2} r={3} />
                <text x={midX} y={(y1 + y2) / 2 - 6} textAnchor="middle">
                  {cardinalityLabel(rel.type)}
                </text>
              </g>
            );
          })}
        </svg>

        {models.map((model) => {
          const rect = rectByKey.get(model.key)!;
          const selected = impact?.selectedKey === model.key;
          const affected = !selected && !!impact?.affectedKeys.includes(model.key);
          const classes = [
            'genbi-mnode',
            onSelectModel && 'is-interactive',
            selected && 'is-selected',
            affected && 'is-affected',
          ]
            .filter(Boolean)
            .join(' ');
          const nodeStyle = { left: rect.x, top: rect.y, width: rect.width };
          const nodeContent = (
            <>
              <div className="genbi-mh">
                <TableOutlined />
                <span>{model.name}</span>
                <span className="genbi-cnt">
                  {model.columns.length} {t('context.erColumnCount')}
                </span>
              </div>
              <ul>
                {model.columns.map((col) => (
                  <li key={col.name}>
                    <span className="genbi-fn">{col.name}</span>
                    {col.key && (
                      <Tooltip title={t('context.inferredKeyHint')}>
                        <span className={`genbi-key genbi-key-${col.key}`}>
                          {col.key === 'pk' ? t('context.erPrimaryKey') : t('context.erForeignKey')}
                        </span>
                      </Tooltip>
                    )}
                    <span className="genbi-ft">{col.type}</span>
                  </li>
                ))}
              </ul>
            </>
          );

          return onSelectModel ? (
            <button
              key={model.key}
              type="button"
              data-testid={`er-node-${model.key}`}
              className={classes}
              style={nodeStyle}
              onClick={() => onSelectModel(model.key)}
              aria-label={`${t('context.viewImpact')}: ${model.name}`}
            >
              {nodeContent}
            </button>
          ) : (
            <div
              key={model.key}
              data-testid={`er-node-${model.key}`}
              className={classes}
              style={nodeStyle}
            >
              {nodeContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}
