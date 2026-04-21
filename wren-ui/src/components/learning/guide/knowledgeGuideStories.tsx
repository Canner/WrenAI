import type { NextRouter } from 'next/router';
import { renderToString } from 'react-dom/server';

import { appMessage as message } from '@/utils/antdAppBridge';
import { nextTick } from '@/utils/time';

import {
  defaultGuideDriverConfig,
  GuidePreviewPanel,
  resetGuidePopoverStyle,
  RobotIcon,
} from './storyShared';
import type { StoryPayload } from './storyTypes';
import type { Dispatcher, DriverObj, DriverPopoverDOM } from './utils';

export const playKnowledgeGuide = (
  $driver: DriverObj,
  _router: NextRouter,
  _payload: StoryPayload,
  dispatcher: Dispatcher,
) => {
  if ($driver === null) {
    message.warning('引导组件尚未初始化。');
    return;
  }
  if ($driver.isActive()) $driver.destroy();

  $driver.setConfig({ ...defaultGuideDriverConfig, showProgress: true });
  $driver.setSteps([
    {
      element: '[data-guideid="sql-templates"]',
      popover: {
        title: renderToString(
          <div className="pt-4">
            <GuidePreviewPanel
              eyebrow="知识库工作台"
              title="SQL 模板"
              points={[
                '统一沉淀高价值 SQL 查询模式',
                '支持按问题匹配或全局复用',
                '从问答结果一键保存为模板',
              ]}
            />
            建设知识库：SQL 模板
          </div>,
        ),
        description: renderToString(
          <>
            创建并管理 <b>SQL 模板</b>，持续优化系统的 SQL
            生成效果。你可以在这里手动新增模板，也可以先回到首页提问，再把正确结果保存为模板。沉淀得越多，后续问答越稳定。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetGuidePopoverStyle(popoverDom, 640);
        },
      },
    },
    {
      element: '[data-guideid="instructions"]',
      popover: {
        title: renderToString(
          <div className="pt-4">
            <GuidePreviewPanel
              eyebrow="知识库工作台"
              title="分析规则"
              points={[
                '统一业务口径与查询约束',
                '让模型遵循稳定的分析规范',
                '与 SQL 模板配合提升回答一致性',
              ]}
            />
            建设知识库：分析规则
          </div>,
        ),
        description: renderToString(
          <>
            除了 SQL 模板外，你还可以新增分析规则，统一定义 <b>业务口径</b> 和{' '}
            <b>查询逻辑</b>。 这些规则会帮助系统在生成 SQL
            时保持一致的过滤条件、约束和最佳实践。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetGuidePopoverStyle(popoverDom, 640);
        },
      },
    },
    {
      element: '[data-guideid="open-modeling-workspace"]',
      popover: {
        title: renderToString(
          <div className="pt-4">
            <GuidePreviewPanel
              eyebrow="知识库工作台"
              title="语义建模"
              points={[
                '查看模型、字段与关系结构',
                '持续补齐语义信息与展示名称',
                '让问答、模板与规则共享同一上下文',
              ]}
            />
            建设知识库：语义建模
          </div>,
        ),
        description: renderToString(
          <>
            除了模板和规则，知识库还可以继续补充 <b>语义建模</b> 信息。
            你可以查看当前知识库对应的模型结构、字段和关系，帮助系统更准确理解业务实体。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetGuidePopoverStyle(popoverDom, 520);
        },
        doneBtnText: '知道了',
        onNextClick: () => {
          $driver.destroy();
          dispatcher?.onDone && dispatcher.onDone();
        },
      },
    },
  ]);
  $driver.drive();
};

export const playSaveToKnowledgeGuide = async (
  $driver: DriverObj,
  _router: NextRouter,
  _payload: StoryPayload,
  dispatcher: Dispatcher,
) => {
  if ($driver === null) {
    message.warning('引导组件尚未初始化。');
    return;
  }
  if ($driver.isActive()) $driver.destroy();

  $driver.setConfig({ ...defaultGuideDriverConfig, showProgress: false });

  const selectors = {
    saveToKnowledge:
      '[data-guideid="last-answer-result"] [data-guideid="save-to-knowledge"]',
    previewData:
      '[data-guideid="last-answer-result"] [data-guideid="text-answer-preview-data"]',
  };

  $driver.setSteps([
    {
      element: selectors.saveToKnowledge,
      popover: {
        side: 'top',
        align: 'start',
        title: renderToString(
          <>
            <div className="mb-1">
              <RobotIcon />
            </div>
            保存为 SQL 模板
          </>,
        ),
        description: renderToString(
          <>
            如果当前回答正确，可以将它保存为 <b>SQL 模板</b>
            ，帮助系统积累稳定经验。
            如果结果还不准确，建议先继续追问或调整，再保存为模板。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetGuidePopoverStyle(popoverDom, 360);
        },
        doneBtnText: '知道了',
        onNextClick: () => {
          $driver.destroy();
          dispatcher?.onDone && dispatcher.onDone();
        },
      },
    },
  ]);

  let mutationObserver: MutationObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  const cleanMutationObserverup = () => {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  };
  const cleanIntersectionObserverup = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
  };
  const startDriver = () => {
    const target = document.querySelector(
      selectors.previewData,
    ) as HTMLElement | null;
    if (!target) return false;
    cleanMutationObserverup();
    intersectionObserver = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            cleanIntersectionObserverup();
            await nextTick(700);
            $driver.drive();
            return;
          }
        }
      },
      { threshold: 0.5 },
    );
    intersectionObserver.observe(target);
    return true;
  };

  if (startDriver()) return;

  mutationObserver = new MutationObserver(() => {
    if (startDriver()) {
      cleanMutationObserverup();
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  await nextTick(60000);
  cleanMutationObserverup();
  cleanIntersectionObserverup();
};
