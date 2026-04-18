import { SampleDatasetName } from '@/types/dataSource';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextRouter } from 'next/router';
import { Select, message } from 'antd';
import styled from 'styled-components';
import { ModelIcon, TranslateIcon } from '@/utils/icons';
import { RobotSVG } from '@/utils/svgs';
import { renderToString } from 'react-dom/server';
import { ProjectLanguage } from '@/types/project';
import {
  Dispatcher,
  DriverConfig,
  DriverObj,
  DriverPopoverDOM,
  LEARNING,
} from './utils';
import { Path } from '@/utils/enum';

import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { TEMPLATE_OPTIONS as SAMPLE_DATASET_INFO } from '@/components/pages/setup/utils';
import { getLanguageText } from '@/utils/language';
import * as events from '@/utils/events';
import { nextTick } from '@/utils/time';

const RobotIcon = styled(RobotSVG)`
  width: 24px;
  height: 24px;
`;

const GuidePreviewPanel = (props: {
  eyebrow: string;
  title: string;
  points: string[];
}) => {
  const { eyebrow, title, points } = props;

  return (
    <div
      style={{
        margin: '0 -16px 16px',
        padding: '18px 18px 16px',
        borderRadius: 14,
        border: '1px solid #e6e8ec',
        background:
          'linear-gradient(180deg, rgba(123, 85, 232, 0.08), rgba(123, 85, 232, 0.02))',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(123, 85, 232, 0.12)',
          color: '#6f42c1',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 22,
          fontWeight: 700,
          color: '#1f2937',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gap: 8,
        }}
      >
        {points.map((point) => (
          <div
            key={point}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#fff',
              border: '1px solid #edf0f4',
              color: '#344054',
              fontSize: 14,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#7b55e8',
                flex: '0 0 auto',
              }}
            />
            <span>{point}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const defaultConfigs: DriverConfig = {
  progressText: '{{current}} / {{total}}',
  nextBtnText: '下一步',
  prevBtnText: '上一步',
  showButtons: ['next'],
  allowClose: false,
};

type StoryPayload = {
  sampleDataset?: SampleDatasetName;
  language?: ProjectLanguage;
};

export const makeStoriesPlayer =
  (...args: [DriverObj, NextRouter, StoryPayload]) =>
  (id: string, dispatcher: Dispatcher) => {
    const action =
      {
        [LEARNING.DATA_MODELING_GUIDE]: () =>
          playDataModelingGuide(...args, dispatcher),
        [LEARNING.SWITCH_PROJECT_LANGUAGE]: () =>
          playSwitchProjectLanguageGuide(...args, dispatcher),
        [LEARNING.KNOWLEDGE_GUIDE]: () =>
          playKnowledgeGuide(...args, dispatcher),
        [LEARNING.SAVE_TO_KNOWLEDGE]: () =>
          playSaveToKnowledgeGuide(...args, dispatcher),
      }[id] || null;
    return action && action();
  };

const resetPopoverStyle = (popoverDom: DriverPopoverDOM, width: number) => {
  const wrapper = popoverDom.wrapper;
  wrapper.style.maxWidth = 'none';
  wrapper.style.width = `${width}px`;
};

const playDataModelingGuide = (
  $driver: DriverObj,
  router: NextRouter,
  payload: StoryPayload,
  dispatcher: Dispatcher,
) => {
  if ($driver === null) {
    message.warning('引导组件尚未初始化。');
    return;
  }
  if ($driver.isActive()) $driver.destroy();

  const sampleDataset = payload.sampleDataset;
  const sampleDatasetInfo =
    sampleDataset && sampleDataset in SAMPLE_DATASET_INFO
      ? SAMPLE_DATASET_INFO[sampleDataset as keyof typeof SAMPLE_DATASET_INFO]
      : null;

  $driver.setConfig({ ...defaultConfigs, showProgress: true });
  $driver.setSteps([
    {
      popover: {
        title: renderToString(
          <div className="pt-4">
            <div className="-mx-4" style={{ minHeight: 331 }}>
              <img
                className="mb-4"
                src="/images/learning/data-modeling.jpg"
                alt="data-modeling-guide"
              />
            </div>
            数据建模指南
          </div>,
        ),
        description: renderToString(
          <>
            数据建模会在原始数据表之上增加一层语义层，用来组织关系、业务语义和计算逻辑。
            这样可以帮助 AI
            更好地理解业务含义、检索准确数据，并生成更有价值的分析结果。{' '}
            <a
              href="https://docs.getwren.ai/oss/guide/modeling/overview"
              target="_blank"
              rel="noopener noreferrer"
            >
              了解更多
            </a>
            <br />
            <br />
            {sampleDatasetInfo ? (
              <>
                本指南会使用 {sampleDatasetInfo.label}{' '}
                样例数据进行演示。更多说明可查看{' '}
                <a
                  href={sampleDatasetInfo.guide}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {sampleDatasetInfo.label} 样例数据介绍
                </a>
              </>
            ) : null}
          </>,
        ),
        showButtons: ['next', 'close'],
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 720);
        },
        onCloseClick: () => {
          $driver.destroy();
          window.sessionStorage.setItem('skipDataModelingGuide', '1');
        },
      },
    },
    {
      element: '[data-guideid="add-model"]',
      popover: {
        title: renderToString(
          <>
            <div className="mb-1">
              <ModelIcon style={{ fontSize: 24 }} />
            </div>
            创建模型
          </>,
        ),
        description: renderToString(
          <>点击新增按钮，开始创建你的第一个模型。</>,
        ),
      },
    },
    {
      element: '[data-guideid="edit-model-0"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4" style={{ minHeight: 175 }}>
              <img
                className="mb-2"
                src="/images/learning/edit-model.gif"
                alt="edit-model"
              />
            </div>
            编辑模型
          </>,
        ),
        description: renderToString(
          <>点击更多按钮，可以修改模型字段配置，或直接删除该模型。</>,
        ),
      },
    },
    {
      element: '[data-guideid="model-0"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4" style={{ minHeight: 214 }}>
              <img
                className="mb-2"
                src="/images/learning/edit-metadata.gif"
                alt="edit-metadata"
              />
            </div>
            编辑元数据
          </>,
        ),
        description: renderToString(
          <>你可以修改模型和字段的显示名称，以及对应的描述信息。</>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 360);
        },
      },
    },
    {
      element: '[data-guideid="deploy-model"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4" style={{ minHeight: 102 }}>
              <img
                className="mb-2"
                src="/images/learning/deploy-modeling.jpg"
                alt="deploy-modeling"
              />
            </div>
            发布建模变更
          </>,
        ),
        description: renderToString(
          <>完成模型编辑后，记得发布变更，让最新语义层立即生效。</>,
        ),
      },
    },
    {
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4" style={{ minHeight: 331 }}>
              <img
                className="mb-2"
                src="/images/learning/ask-question.jpg"
                alt="ask-question"
              />
            </div>
            开始提问
          </>,
        ),
        description: renderToString(
          <>
            完成建模后，你就可以进入“首页”开始提问，查看 SQL 与图表分析结果。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 720);
        },
        doneBtnText: '前往首页',
        onNextClick: () => {
          router.push(buildRuntimeScopeUrl(Path.Home));
          $driver.destroy();
          dispatcher?.onDone && dispatcher.onDone();
        },
      },
    },
  ]);
  events.dispatch(events.EVENT_NAME.GO_TO_FIRST_MODEL);
  $driver.drive();
};

// React component for home guide
const LanguageSwitcher = (props: { defaultValue: ProjectLanguage }) => {
  const [value, setValue] = useState(props.defaultValue);
  const languageOptions = Object.keys(ProjectLanguage).map((key) => {
    return { label: getLanguageText(key as ProjectLanguage), value: key };
  });
  const onChange = (value: string) => {
    setValue(value as ProjectLanguage);
  };

  return (
    <>
      <label className="d-block mb-2">知识库语言</label>
      <Select
        showSearch
        style={{ width: '100%' }}
        options={languageOptions}
        getPopupContainer={(trigger) => trigger.parentElement}
        onChange={onChange}
        value={value}
      />
      <input name="language" type="hidden" value={value} />
    </>
  );
};

const playSwitchProjectLanguageGuide = (
  $driver: DriverObj,
  _router: NextRouter,
  payload: StoryPayload,
  dispatcher: Dispatcher,
) => {
  if ($driver === null) {
    message.warning('引导组件尚未初始化。');
    return;
  }
  if ($driver.isActive()) $driver.destroy();

  $driver.setConfig({ ...defaultConfigs, showProgress: false });
  $driver.setSteps([
    {
      popover: {
        title: renderToString(
          <>
            <div className="mb-1">
              <TranslateIcon style={{ fontSize: 24 }} />
            </div>
            切换对话语言
          </>,
        ),
        description: renderToString(
          <>
            选择你希望使用的默认语言。设置完成后，AI 会优先用该语言与你对话。
            <div className="my-3">
              <div id="projectLanguageContainer" />
            </div>
            后续如果想调整，也可以随时到设置中修改。
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 400);
          // Render react component to #projectLanguageContainer
          const selectDom = document.getElementById('projectLanguageContainer');
          if (selectDom) {
            createRoot(selectDom).render(
              <LanguageSwitcher
                defaultValue={payload.language || ProjectLanguage.ZH_CN}
              />,
            );
          }
        },
        showButtons: ['next', 'close'],
        nextBtnText: '保存',
        onCloseClick: () => {
          $driver.destroy();
          window.sessionStorage.setItem('skipSwitchProjectLanguageGuide', '1');
        },
        onNextClick: async () => {
          const selectDom = document.getElementById('projectLanguageContainer');
          if (selectDom) {
            const input = selectDom.querySelector(
              'input[name="language"]',
            ) as HTMLInputElement;
            const nextButton = document.querySelectorAll(
              '.driver-popover-next-btn',
            )[0];

            const loadingSvg = document.createElement('span');
            loadingSvg.setAttribute('aria-hidden', 'loading');
            loadingSvg.setAttribute('role', 'img');
            loadingSvg.className =
              'anticon anticon-loading anticon-spin text-sm gray-6 ml-2';
            loadingSvg.innerHTML = `<svg viewBox="0 0 1024 1024" focusable="false" data-icon="loading" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M988 548c-19.9 0-36-16.1-36-36 0-59.4-11.6-117-34.6-171.3a440.45 440.45 0 00-94.3-139.9 437.71 437.71 0 00-139.9-94.3C629 83.6 571.4 72 512 72c-19.9 0-36-16.1-36-36s16.1-36 36-36c69.1 0 136.2 13.5 199.3 40.3C772.3 66 827 103 874 150c47 47 83.9 101.8 109.7 162.7 26.7 63.1 40.2 130.2 40.2 199.3.1 19.9-16 36-35.9 36z"></path></svg>`;
            nextButton.setAttribute('disabled', 'true');
            nextButton.appendChild(loadingSvg);
            try {
              await dispatcher?.onSaveLanguage?.(
                input.value as ProjectLanguage,
              );
            } catch (err) {
              message.error(
                err instanceof Error
                  ? err.message
                  : '保存语言设置失败，请稍后重试。',
              );
            } finally {
              nextButton.removeAttribute('disabled');
              nextButton.removeChild(loadingSvg);
            }
          }
          $driver.destroy();
          await dispatcher?.onDone?.();
        },
      },
    },
  ]);
  $driver.drive();
};

const playKnowledgeGuide = (
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

  $driver.setConfig({ ...defaultConfigs, showProgress: true });

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
          resetPopoverStyle(popoverDom, 640);
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
          resetPopoverStyle(popoverDom, 520);
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

const playSaveToKnowledgeGuide = async (
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

  $driver.setConfig({ ...defaultConfigs, showProgress: false });

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
          resetPopoverStyle(popoverDom, 360);
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
    // if MutationObserver is listening to the element, disable it
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

    // use IntersectionObserver to ensure the element is in viewport before driving
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
      { threshold: 0.5 }, // 50% of the element is visible
    );

    intersectionObserver.observe(target);
    return true;
  };

  // try to start Driver.js
  if (startDriver()) return;

  // if the target element not appear, use MutationObserver to listen DOM changes
  mutationObserver = new MutationObserver(() => {
    if (startDriver()) {
      cleanMutationObserverup();
    }
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  // 60 seconds after, observer will be cleared
  await nextTick(60000);
  cleanMutationObserverup();
  cleanIntersectionObserverup();
};
