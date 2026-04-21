import type { NextRouter } from 'next/router';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { appMessage as message } from '@/utils/antdAppBridge';
import { TEMPLATE_OPTIONS as SAMPLE_DATASET_INFO } from '@/components/pages/setup/utils';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { ProjectLanguage } from '@/types/project';
import { Path } from '@/utils/enum';
import * as events from '@/utils/events';
import { ModelIcon, TranslateIcon } from '@/utils/icons';

import {
  defaultGuideDriverConfig,
  LanguageSwitcher,
  resetGuidePopoverStyle,
} from './storyShared';
import type { StoryPayload } from './storyTypes';
import type { Dispatcher, DriverObj, DriverPopoverDOM } from './utils';

export const playDataModelingGuide = (
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

  $driver.setConfig({ ...defaultGuideDriverConfig, showProgress: true });
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
          resetGuidePopoverStyle(popoverDom, 720);
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
          resetGuidePopoverStyle(popoverDom, 360);
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
          resetGuidePopoverStyle(popoverDom, 720);
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

export const playSwitchProjectLanguageGuide = (
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

  $driver.setConfig({ ...defaultGuideDriverConfig, showProgress: false });
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
          resetGuidePopoverStyle(popoverDom, 400);
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
