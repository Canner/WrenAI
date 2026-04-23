import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchArtifactKind } from './threadWorkbenchState';

export type ThreadWorkbenchLocale = 'zh-CN' | 'en-US';

export type ThreadWorkbenchMessages = {
  answer: {
    badge: string;
  };
  close: string;
  headerActions: {
    pinDashboard: string;
    spreadsheet: string;
  };
  chart: {
    badge: string;
    alerts: {
      failedShort: string;
    };
    actions: {
      create: string;
      generating: string;
      regenerate: string;
      view: string;
    };
    descriptions: {
      askCreate: string;
      askFailed: string;
      askGenerating: string;
      askReady: string;
      followUpGenerating: string;
      followUpReady: string;
      noChartFallback: string;
    };
    statuses: {
      enhance: string;
      failed: string;
      generated: string;
      generating: string;
    };
    syntheticQuestion: string;
    teaserTitle: string;
  };
  recommendation: {
    actions: {
      retry: string;
    };
    alerts: {
      failedShort: string;
    };
    badge: string;
    categories: {
      chartFollowUp: string;
      chartRefine: string;
      compare: string;
      distribution: string;
      drillDown: string;
      ranking: string;
      relatedQuestion: string;
      trend: string;
    };
    notifications: {
      generateFailed: string;
      sourceNotReady: string;
    };
    sectionIntro: string;
    sectionTitle: string;
    triggerLabel: string;
  };
  footer: {
    helpfulNegative: string;
    helpfulPositive: string;
    helpfulPrompt: string;
    openSavedView: string;
    saveSqlTemplate: string;
    saveView: string;
    viewSaved: string;
  };
  preview: {
    emptyDescription: string;
    refresh: string;
    rowLimitHint: string;
    teaserAction: string;
    teaserDescription: string;
    teaserTag: string;
    teaserTitle: string;
    viewResult: string;
  };
  sql: {
    adjust: string;
    copied: string;
    copy: string;
    copyFailed: string;
    view: string;
  };
  tabs: Record<WorkbenchArtifactKind, string>;
  titleLabel: string;
};

const THREAD_WORKBENCH_MESSAGE_CATALOG: Record<
  ThreadWorkbenchLocale,
  ThreadWorkbenchMessages
> = {
  'zh-CN': {
    answer: {
      badge: '自动分析',
    },
    close: '关闭结果区',
    headerActions: {
      spreadsheet: 'Spreadsheet',
      pinDashboard: '固定到看板',
    },
    titleLabel: '结果工作台',
    footer: {
      helpfulPrompt: 'Was this result helpful?',
      helpfulPositive: '有帮助',
      helpfulNegative: '没有帮助',
      saveSqlTemplate: '保存为 SQL 模板',
      saveView: '保存为视图',
      viewSaved: '已保存视图',
      openSavedView: '查看已保存视图',
    },
    tabs: {
      preview: '数据预览',
      sql: 'SQL 查询',
      chart: '图表',
    },
    preview: {
      teaserTitle: '数据预览',
      teaserTag: '结果',
      teaserDescription: '在右侧查看当前结果明细，并继续切换 SQL 与数据。',
      teaserAction: '查看数据',
      refresh: '刷新结果',
      emptyDescription: '未找到符合当前查询条件的数据记录。',
      rowLimitHint: '最多展示 500 行',
      viewResult: '查看结果',
    },
    sql: {
      copy: '复制 SQL',
      adjust: '调整 SQL',
      copied: '已复制当前显示的 SQL。',
      copyFailed: '复制 SQL 失败，请稍后重试。',
      view: '查看 SQL',
    },
    chart: {
      badge: '图表追问',
      teaserTitle: '图表',
      statuses: {
        generated: '已生成',
        failed: '失败',
        generating: '生成中',
        enhance: '增强',
      },
      descriptions: {
        followUpReady: '图表已生成，可在右侧继续查看。',
        followUpGenerating: '正在根据当前结果生成图表。',
        askReady: '已有图表结果，可直接在右侧查看。',
        askFailed: '图表生成失败，可重新发起。',
        askGenerating: '正在根据当前结果生成图表。',
        askCreate: '基于当前结果生成图表。',
        noChartFallback: '图表生成失败，请重新生成。',
      },
      actions: {
        view: '查看图表',
        regenerate: '重新生成',
        generating: '生成中',
        create: '生成图表',
      },
      alerts: {
        failedShort: '图表生成失败',
      },
      syntheticQuestion: '生成图表',
    },
    recommendation: {
      badge: '推荐问题',
      triggerLabel: '推荐几个问题给我',
      sectionTitle: '推荐追问',
      sectionIntro: '基于刚刚这条结果，你接下来还可以问：',
      alerts: {
        failedShort: '推荐问题生成失败',
      },
      actions: {
        retry: '重新生成',
      },
      notifications: {
        sourceNotReady: '当前回答尚未就绪，请稍后再试',
        generateFailed: '生成推荐追问失败，请稍后重试',
      },
      categories: {
        drillDown: '深挖',
        compare: '对比',
        trend: '趋势',
        distribution: '分布',
        ranking: '排行',
        chartFollowUp: '转成图表',
        chartRefine: '优化图表',
        relatedQuestion: '相关问题',
      },
    },
  },
  'en-US': {
    answer: {
      badge: 'Auto analysis',
    },
    close: 'Close workbench',
    headerActions: {
      spreadsheet: 'Spreadsheet',
      pinDashboard: 'Pin to dashboard',
    },
    titleLabel: 'Result workbench',
    footer: {
      helpfulPrompt: 'Was this result helpful?',
      helpfulPositive: 'Helpful',
      helpfulNegative: 'Not helpful',
      saveSqlTemplate: 'Save as SQL template',
      saveView: 'Save as view',
      viewSaved: 'Saved view',
      openSavedView: 'Open saved view',
    },
    tabs: {
      preview: 'Data Preview',
      sql: 'SQL Query',
      chart: 'Chart',
    },
    preview: {
      teaserTitle: 'Data Preview',
      teaserTag: 'Result',
      teaserDescription:
        'Inspect the current result in the workbench and switch between SQL and data.',
      teaserAction: 'View data',
      refresh: 'Refresh result',
      emptyDescription: 'No rows matched the current query.',
      rowLimitHint: 'Showing up to 500 rows',
      viewResult: 'View result',
    },
    sql: {
      copy: 'Copy SQL',
      adjust: 'Adjust SQL',
      copied: 'Copied the current SQL.',
      copyFailed: "Couldn't copy SQL. Please try again.",
      view: 'View SQL',
    },
    chart: {
      badge: 'Chart follow-up',
      teaserTitle: 'Chart',
      statuses: {
        generated: 'Generated',
        failed: 'Failed',
        generating: 'Generating',
        enhance: 'Enhance',
      },
      descriptions: {
        followUpReady:
          'The chart is ready. Open it in the workbench to continue.',
        followUpGenerating: 'Generating a chart from the current result.',
        askReady:
          'A chart result already exists. Open it directly in the workbench.',
        askFailed: 'Chart generation failed. You can try again.',
        askGenerating: 'Generating a chart from the current result.',
        askCreate: 'Generate a chart from the current result.',
        noChartFallback: 'Chart generation failed. Please try again.',
      },
      actions: {
        view: 'View chart',
        regenerate: 'Regenerate',
        generating: 'Generating',
        create: 'Generate chart',
      },
      alerts: {
        failedShort: 'Chart generation failed',
      },
      syntheticQuestion: 'Generate chart',
    },
    recommendation: {
      badge: 'Recommendations',
      triggerLabel: 'Recommend follow-up questions',
      sectionTitle: 'Recommended follow-ups',
      sectionIntro: 'Based on this result, you could ask next:',
      alerts: {
        failedShort: 'Recommendation generation failed',
      },
      actions: {
        retry: 'Retry',
      },
      notifications: {
        sourceNotReady:
          'The current answer is not ready yet. Please try again.',
        generateFailed: "Couldn't generate recommendations. Please try again.",
      },
      categories: {
        drillDown: 'Drill down',
        compare: 'Compare',
        trend: 'Trend',
        distribution: 'Distribution',
        ranking: 'Ranking',
        chartFollowUp: 'Make chart',
        chartRefine: 'Refine chart',
        relatedQuestion: 'Related',
      },
    },
  },
};

const DEFAULT_THREAD_WORKBENCH_LOCALE: ThreadWorkbenchLocale = 'zh-CN';

export const resolveThreadWorkbenchLocale = (
  locale?: string | null,
): ThreadWorkbenchLocale => {
  const normalizedLocale = (locale || '').trim().toLowerCase();
  if (!normalizedLocale) {
    return DEFAULT_THREAD_WORKBENCH_LOCALE;
  }

  if (normalizedLocale.startsWith('en')) {
    return 'en-US';
  }

  if (normalizedLocale.startsWith('zh')) {
    return 'zh-CN';
  }

  return DEFAULT_THREAD_WORKBENCH_LOCALE;
};

export const getThreadWorkbenchMessages = (locale?: string | null) =>
  THREAD_WORKBENCH_MESSAGE_CATALOG[resolveThreadWorkbenchLocale(locale)];

export const useThreadWorkbenchMessages = (locale?: string | null) => {
  const [resolvedLocale, setResolvedLocale] = useState<ThreadWorkbenchLocale>(
    resolveThreadWorkbenchLocale(locale),
  );

  useEffect(() => {
    setResolvedLocale(resolveThreadWorkbenchLocale(locale));
  }, [locale]);

  return useMemo(
    () => THREAD_WORKBENCH_MESSAGE_CATALOG[resolvedLocale],
    [resolvedLocale],
  );
};
