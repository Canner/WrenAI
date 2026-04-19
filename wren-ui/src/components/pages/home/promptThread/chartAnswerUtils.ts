import { type ComponentType } from 'react';
import BasicProperties, {
  type PropertiesProps,
} from '@/components/chart/properties/BasicProperties';
import DonutProperties from '@/components/chart/properties/DonutProperties';
import LineProperties from '@/components/chart/properties/LineProperties';
import StackedBarProperties from '@/components/chart/properties/StackedBarProperties';
import GroupedBarProperties from '@/components/chart/properties/GroupedBarProperties';
import { ChartTaskStatus, ChartType } from '@/types/home';

const normalizeFieldToken = (value: string) =>
  value.replace(/[`"]/g, '').replace(/\s+/g, '').trim().toLowerCase();

const buildFieldAliases = (field: string): string[] => {
  const normalized = normalizeFieldToken(field);
  if (!normalized) return [];

  const aliases = new Set<string>([normalized]);
  if (normalized.includes('.')) {
    aliases.add(normalized.split('.').pop() as string);
  }

  const aggregateMatch = normalized.match(/^([a-z_][a-z0-9_]*)\((.+)\)$/i);
  if (aggregateMatch) {
    const fn = aggregateMatch[1];
    const arg = aggregateMatch[2];
    aliases.add(`${fn}(${arg})`);
    if (arg.includes('.')) {
      aliases.add(`${fn}(${arg.split('.').pop()})`);
    }
  }

  return Array.from(aliases);
};

export const isCompatibleFieldName = (
  targetField: string,
  sourceField: string,
) => {
  const targetAliases = buildFieldAliases(targetField);
  if (targetAliases.length === 0) return false;
  const sourceAliases = new Set(buildFieldAliases(sourceField));
  return targetAliases.some((alias) => sourceAliases.has(alias));
};

export const toPreferredRenderer = (
  value: unknown,
): 'svg' | 'canvas' | undefined =>
  value === 'svg' || value === 'canvas' ? value : undefined;

export const getIsChartFinished = (
  status?: ChartTaskStatus | null,
): boolean => {
  if (!status) {
    return false;
  }
  return [
    ChartTaskStatus.FINISHED,
    ChartTaskStatus.FAILED,
    ChartTaskStatus.STOPPED,
  ].includes(status);
};

export const getDynamicProperties = (chartType?: ChartType | null) => {
  const propertiesMap: Partial<
    Record<ChartType, ComponentType<PropertiesProps>>
  > = {
    [ChartType.GROUPED_BAR]: GroupedBarProperties,
    [ChartType.STACKED_BAR]: StackedBarProperties,
    [ChartType.LINE]: LineProperties,
    [ChartType.MULTI_LINE]: LineProperties,
    [ChartType.PIE]: DonutProperties,
  };
  if (!chartType) {
    return BasicProperties;
  }
  return propertiesMap[chartType] || BasicProperties;
};
