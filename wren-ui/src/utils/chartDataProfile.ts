export const summarizeChartDataProfile = (
  chartDataProfile?: Record<string, any> | null,
): string[] => {
  const safeProfile = chartDataProfile || {};
  const appliedShaping = Array.isArray(safeProfile.appliedShaping)
    ? safeProfile.appliedShaping
    : [];

  const lines = appliedShaping
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      switch (item.type) {
        case 'top_n':
          return `已按服务端规则仅保留 Top ${item.value} 类别`;
        case 'other_bucket':
          return '其余类别已汇总为 Other';
        case 'time_downsample':
          return `时间序列已做服务端抽样，当前展示 ${item.value} 个点`;
        case 'series_downsample':
          return `序列已做服务端抽样，当前展示 ${item.value} 个点`;
        default:
          return null;
      }
    })
    .filter((value): value is string => Boolean(value));

  if (
    typeof safeProfile.sourceRowCount === 'number' &&
    typeof safeProfile.resultRowCount === 'number' &&
    safeProfile.sourceRowCount !== safeProfile.resultRowCount
  ) {
    lines.push(
      `展示数据已从 ${safeProfile.sourceRowCount} 行收敛为 ${safeProfile.resultRowCount} 行`,
    );
  }

  return lines;
};
