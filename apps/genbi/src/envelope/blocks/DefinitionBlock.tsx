import { Tag, Typography } from 'antd';
import { brand } from '@/app/theme/tokens';
import { KVRow } from '@/ui';
import { t } from '@/i18n/strings';
import type { DefinitionBlock as DefinitionBlockData } from '../types';

interface Props {
  block: DefinitionBlockData;
}

/** Shows how an answer was derived: the SQL plus its source tables and filters. */
export function DefinitionBlock({ block }: Props) {
  const { sql, source_tables, filters } = block;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('envelope.definitionSql')}
        </Typography.Text>
        <pre
          style={{
            margin: '4px 0 0',
            padding: 12,
            borderRadius: 8,
            overflowX: 'auto',
            fontFamily: brand.fontFamilyCode,
            fontSize: 13,
            background: 'var(--ant-color-fill-quaternary)',
          }}
        >
          <code>{sql}</code>
        </pre>
      </div>

      <KVRow
        label={t('envelope.definitionSources')}
        value={
          source_tables.length ? (
            <span>
              {source_tables.map((s) => (
                <Tag key={s} style={{ marginInlineEnd: 4 }}>
                  {s}
                </Tag>
              ))}
            </span>
          ) : (
            t('envelope.definitionNoneFallback')
          )
        }
      />
      <KVRow
        label={t('envelope.definitionFilters')}
        value={
          filters.length ? (
            <span>
              {filters.map((f) => (
                <Tag key={f} color="blue" style={{ marginInlineEnd: 4 }}>
                  {f}
                </Tag>
              ))}
            </span>
          ) : (
            t('envelope.definitionEmptyFallback')
          )
        }
      />
    </div>
  );
}
