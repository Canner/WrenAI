import { Statistic } from 'antd';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { KpiCardBlock as KpiCardBlockData } from '../types';

interface Props {
  block: KpiCardBlockData;
}

/** A single KPI: label + value (+ unit) with an optional signed delta. */
export function KpiCardBlock({ block }: Props) {
  const { label, value, unit, delta } = block;
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;

  return (
    <Statistic
      title={label}
      value={value}
      suffix={
        <span style={{ fontSize: 14 }}>
          {unit ? <span style={{ opacity: 0.65 }}> {unit}</span> : null}
          {hasDelta && (
            // Blocks carry no good/bad direction, so the delta color stays
            // neutral; the caret icon conveys the sign (also the a11y channel).
            <span style={{ marginLeft: 8, color: 'var(--ant-color-text-secondary)' }}>
              {up ? <CaretUpOutlined /> : <CaretDownOutlined />}
              {Math.abs(delta!)}
            </span>
          )}
        </span>
      }
    />
  );
}
