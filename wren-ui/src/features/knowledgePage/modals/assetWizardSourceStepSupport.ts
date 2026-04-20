import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';

export type AssetTableSelectorItem = KnowledgeAssetSelectOption & {
  baseName: string;
  scopeLabel: string;
  statusLabel: string;
};

export type AssetTableScopeOption = {
  label: string;
  value: string;
  count: number;
};

export type AssetTablePrefixOption = {
  label: string;
  value: string;
  count: number;
};

export type AssetTableSelectorGroup = {
  key: string;
  label: string;
  itemCount: number;
  selectableCount: number;
  items: AssetTableSelectorItem[];
};

const IMPORTED_SUFFIX = ' · 已导入';

const splitQualifiedLabel = (label: string) => {
  const normalizedLabel = label.endsWith(IMPORTED_SUFFIX)
    ? label.slice(0, -IMPORTED_SUFFIX.length)
    : label;
  const segments = normalizedLabel
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      baseName: normalizedLabel,
      scopeLabel: '未识别来源',
    };
  }

  return {
    baseName: segments[segments.length - 1],
    scopeLabel:
      segments.length > 1 ? segments.slice(0, -1).join(' · ') : '默认 schema',
  };
};

export const matchesTablePrefix = (
  option: KnowledgeAssetSelectOption,
  normalizedPrefix: string,
) =>
  [option.label, option.value].some((candidate) =>
    (() => {
      const normalizedCandidate = String(candidate).toLowerCase();
      return (
        normalizedCandidate.startsWith(normalizedPrefix) ||
        normalizedCandidate
          .split('.')
          .some((segment) => segment.startsWith(normalizedPrefix))
      );
    })(),
  );

export const buildAssetTableSelectorItems = (
  assetTableOptions: KnowledgeAssetSelectOption[],
): AssetTableSelectorItem[] =>
  assetTableOptions.map((option) => {
    const { baseName, scopeLabel } = splitQualifiedLabel(option.label);

    return {
      ...option,
      baseName,
      scopeLabel,
      statusLabel: option.imported ? '已导入' : '可引入',
    };
  });

const resolveBaseNamePrefix = (baseName: string) => {
  const normalizedBaseName = baseName.trim().toLowerCase();
  const match = normalizedBaseName.match(/^([a-z][a-z0-9]{1,7})_/i);

  if (!match?.[1]) {
    return null;
  }

  return `${match[1]}_`;
};

export const resolveAssetTableQuickFilters = (
  assetTableOptions: KnowledgeAssetSelectOption[],
): {
  scopeOptions: AssetTableScopeOption[];
  prefixOptions: AssetTablePrefixOption[];
} => {
  const selectorItems = buildAssetTableSelectorItems(assetTableOptions);
  const scopeCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();

  selectorItems.forEach((item) => {
    scopeCounts.set(item.scopeLabel, (scopeCounts.get(item.scopeLabel) || 0) + 1);

    if (item.imported) {
      return;
    }

    const prefix = resolveBaseNamePrefix(item.baseName);
    if (!prefix) {
      return;
    }

    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
  });

  const scopeOptions = [
    {
      label: '全部',
      value: 'all',
      count: selectorItems.length,
    },
    ...Array.from(scopeCounts.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0]);
      })
      .map(([label, count]) => ({
        label,
        value: label,
        count,
      })),
  ];

  const prefixOptions = Array.from(prefixCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, 6)
    .map(([value, count]) => ({
      label: value,
      value,
      count,
    }));

  return {
    scopeOptions,
    prefixOptions,
  };
};

export const buildAssetTableSelectorGroups = (
  items: AssetTableSelectorItem[],
): AssetTableSelectorGroup[] => {
  const groups = new Map<string, AssetTableSelectorGroup>();

  items.forEach((item) => {
    const existingGroup = groups.get(item.scopeLabel);
    if (existingGroup) {
      existingGroup.items.push(item);
      existingGroup.itemCount += 1;
      if (!item.disabled) {
        existingGroup.selectableCount += 1;
      }
      return;
    }

    groups.set(item.scopeLabel, {
      key: item.scopeLabel,
      label: item.scopeLabel,
      itemCount: 1,
      selectableCount: item.disabled ? 0 : 1,
      items: [item],
    });
  });

  return Array.from(groups.values());
};

export const resolveVisibleAssetTableSelectorItems = ({
  activeScopeLabel,
  assetTableOptions,
  hideImportedTables,
  selectedTableValues,
  tablePrefixKeyword,
}: {
  activeScopeLabel?: string;
  assetTableOptions: KnowledgeAssetSelectOption[];
  hideImportedTables: boolean;
  selectedTableValues: string[];
  tablePrefixKeyword: string;
}) => {
  const selectorItems = buildAssetTableSelectorItems(assetTableOptions);
  const normalizedPrefix = tablePrefixKeyword.trim().toLowerCase();
  const selectedValueSet = new Set(selectedTableValues);
  const normalizedScopeLabel =
    activeScopeLabel && activeScopeLabel !== 'all' ? activeScopeLabel : null;

  return selectorItems.filter((item) => {
    if (
      normalizedScopeLabel &&
      item.scopeLabel !== normalizedScopeLabel &&
      !selectedValueSet.has(item.value)
    ) {
      return false;
    }

    if (selectedValueSet.has(item.value)) {
      return true;
    }

    if (hideImportedTables && item.disabled) {
      return false;
    }

    if (!normalizedPrefix) {
      return true;
    }

    return matchesTablePrefix(item, normalizedPrefix);
  });
};
