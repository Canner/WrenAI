import { NextRouter } from 'next/router';
import { ModelIcon } from '@/utils/icons';
import { renderToString } from 'react-dom/server';
import { DriverObj, DriverPopoverDOM, LEARNING } from './utils';
import { Path } from '@/utils/enum';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import { TEMPLATE_OPTIONS as SAMPLE_DATASET_INFO } from '@/components/pages/setup/utils';

export const makeStoriesPlayer =
  (...args: [DriverObj, NextRouter, SampleDatasetName]) =>
  (id: string, onDone: () => void) => {
    const action =
      {
        [LEARNING.DATA_MODELING_GUIDE]: () =>
          playDataModelingGuide(...args, onDone),
      }[id] || null;
    return action && action();
  };

const calculatePopoverInset = (popoverDom: DriverPopoverDOM) => {
  const wrapper = popoverDom.wrapper;
  const wrapperRect = wrapper.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Calculate center position
  const left = (viewportWidth - wrapperRect.width) / 2;
  const top = (viewportHeight - wrapperRect.height) / 2;
  return `${top}px auto auto ${left}px`;
};

const resetPopoverStyle = (popoverDom: DriverPopoverDOM, width: number) => {
  const wrapper = popoverDom.wrapper;
  wrapper.style.maxWidth = 'none';
  wrapper.style.width = `${width}px`;
};

const playDataModelingGuide = (
  $driver: DriverObj,
  router: NextRouter,
  sampleDataset: SampleDatasetName,
  onDone: () => void,
) => {
  if ($driver === null) {
    console.error('Driver object is not initialized.');
    return;
  }
  const isSampleDataset = !!sampleDataset;
  const sampleDatasetInfo = SAMPLE_DATASET_INFO[sampleDataset];
  $driver.setSteps([
    {
      popover: {
        title: renderToString(
          <div className="pt-4">
            <div className="-mx-4">
              <img
                className="mb-4"
                src="/images/learning/data-modeling.jpg"
                alt="ata-modeling-guide"
              />
            </div>
            Data modeling guide
          </div>,
        ),
        description: renderToString(
          <>
            Data modeling adds a logical layer over your original data schema,
            organizing relationships, semantics, and calculations. This helps AI
            align with business logic, retrieve precise data, and generate
            meaningful insights.{' '}
            <a
              href="https://docs.getwren.ai/oss/guide/modeling/overview"
              target="_blank"
              rel="noopener noreferrer"
            >
              More details
            </a>
            <br />
            <br />
            {isSampleDataset ? (
              <>
                We use {sampleDatasetInfo.label} Dataset to present the guide.
                To know more, please visit{' '}
                <a
                  href={sampleDatasetInfo.guide}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  about the {sampleDatasetInfo.label} Dataset.
                </a>
              </>
            ) : null}
          </>,
        ),
        showButtons: ['next', 'close'],
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 720);
          // Image onload problem cause popover not center initially.
          popoverDom.wrapper.querySelector('img').onload = () => {
            popoverDom.wrapper.style.inset = calculatePopoverInset(popoverDom);
          };
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
            <div>
              <ModelIcon />
            </div>
            Create a model
          </>,
        ),
        description: renderToString(
          <>Click the add icon to start create your first model.</>,
        ),
      },
    },
    {
      element: '[data-guideid="edit-model-0"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4">
              <img
                className="mb-2"
                src="/images/learning/edit-model.gif"
                alt="edit-model"
              />
            </div>
            Edit a model
          </>,
        ),
        description: renderToString(
          <>Click the more icon to update the columns of model or delete it.</>,
        ),
      },
    },
    {
      element: '[data-guideid="model-0"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4">
              <img
                className="mb-2"
                src="/images/learning/edit-metadata.gif"
                alt="edit-metadata"
              />
            </div>
            Edit metadata
          </>,
        ),
        description: renderToString(
          <>
            You could edit alias (alternative name) and descriptions of models
            and columns.
          </>,
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
            <img
              className="mb-2"
              src="/images/learning/deploy-modeling.jpg"
              alt="deploy-modeling"
            />
            Deploy modeling
          </>,
        ),
        description: renderToString(
          <>After editing the models, remember to deploy the changes.</>,
        ),
      },
    },
    {
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4">
              <img
                className="mb-2"
                src="/images/learning/ask-question.jpg"
                alt="ask-question"
              />
            </div>
            Ask questions
          </>,
        ),
        description: renderToString(
          <>
            When you finish editing your models, you can visit “Home” and start
            asking questions.
          </>,
        ),
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          resetPopoverStyle(popoverDom, 720);
          // Image onload problem cause popover not center initially.
          popoverDom.wrapper.querySelector('img').onload = () => {
            popoverDom.wrapper.style.inset = calculatePopoverInset(popoverDom);
          };
        },
        doneBtnText: 'Go to Home',
        onNextClick: () => {
          router.push(Path.Home);
          $driver.destroy();
          onDone && onDone();
        },
      },
    },
  ]);
  $driver.drive();
};
