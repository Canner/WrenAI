import { Tag } from 'antd';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { Component, Guardrail } from './types';

interface GuardrailListProps {
  components: Component[];
}

/**
 * Guardrails, aggregated across all components and deduped by name
 * (first-seen component wins). Each row shows the enforcement kind plus
 * either a `locked` badge or the numeric threshold, whichever the guardrail
 * carries.
 */
export function GuardrailList({ components }: GuardrailListProps) {
  const byName = new Map<string, Guardrail>();
  for (const component of components) {
    for (const guardrail of component.guardrails) {
      if (!byName.has(guardrail.name)) byName.set(guardrail.name, guardrail);
    }
  }
  const guardrails = Array.from(byName.values());

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {guardrails.map((guardrail) => (
        <div
          key={guardrail.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            borderTop: '1px solid var(--ant-color-border-secondary)',
          }}
        >
          <strong>{guardrail.name}</strong>
          <Tag bordered>{guardrail.enforcement}</Tag>
          {guardrail.locked ? (
            <Tag color={brand.verified} bordered>
              {t('harness.locked')}
            </Tag>
          ) : guardrail.threshold !== undefined ? (
            <Tag bordered>{guardrail.threshold}</Tag>
          ) : null}
        </div>
      ))}
    </div>
  );
}
