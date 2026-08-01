import { Col, Row, Typography } from 'antd';
import { Panel, StatusTag, verifiedStateOf, ErrorBoundary, type VerifiedState } from '@/ui';
import { t } from '@/i18n/strings';
import { BlockView } from './BlockView';
import type { AnyBlock, RenderEnvelope } from './types';

interface Props {
  envelope: RenderEnvelope;
}

/** Human title for the few block types that read better with a heading. */
function titleFor(block: AnyBlock): string | undefined {
  if (block.type === 'definition') return t('envelope.derivationTitle');
  return undefined;
}

function envelopeState(envelope: RenderEnvelope): VerifiedState {
  if (envelope.estimate === true) return 'estimate';
  return verifiedStateOf(envelope.verified);
}

/**
 * Renders a full answer envelope: a verified/estimate header, an optional
 * summary, then each block. This is the core verified-first surface every
 * downstream view (Ask answers, Artifacts, Eval) reuses.
 */
export function EnvelopeView({ envelope }: Props) {
  const state = envelopeState(envelope);
  // Group only the LEADING contiguous kpi_cards into the top KPI row; render
  // everything after in the agent's original block order (no reordering).
  let lead = 0;
  while (lead < envelope.blocks.length && envelope.blocks[lead].type === 'kpi_card') lead += 1;
  const kpis = envelope.blocks.slice(0, lead);
  const rest = envelope.blocks.slice(lead);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusTag state={state} />
        {state === 'estimate' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('envelope.estimateBasisNote')}
          </Typography.Text>
        )}
      </div>

      {envelope.summary ? (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {envelope.summary}
        </Typography.Paragraph>
      ) : null}

      {kpis.length > 0 && (
        <Row gutter={[16, 16]}>
          {kpis.map((block, i) => (
            <Col key={i} xs={12} md={8} lg={6}>
              <Panel>
                <ErrorBoundary>
                  <BlockView block={block} />
                </ErrorBoundary>
              </Panel>
            </Col>
          ))}
        </Row>
      )}

      {rest.map((block, i) => (
        <Panel key={i} title={titleFor(block)}>
          <ErrorBoundary>
            <BlockView block={block} />
          </ErrorBoundary>
        </Panel>
      ))}
    </div>
  );
}
