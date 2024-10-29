import { NextRouter } from 'next/router';
import { ModelIcon } from '@/utils/icons';
import { renderToString } from 'react-dom/server';
import { DriverObj, DriverPopoverDOM, LEARNING } from './utils';
import { Path } from '@/utils/enum';

export const makeStories =
  (...args: [DriverObj, NextRouter]) =>
  (id: string) => {
    const action =
      {
        [LEARNING.DATA_MODELING_GUIDE]: () => playDataModelingGuide(...args),
      }[id] || null;
    return action && action();
  };

const playDataModelingGuide = ($driver: DriverObj, router: NextRouter) => {
  if ($driver === null) return;
  $driver.setSteps([
    {
      popover: {
        title: renderToString(
          <div className="pt-4">
            <div className="-mx-4">
              <img
                className="mb-4"
                src="/images/learning/edit-model.jpg"
                alt="edit-model"
              />
            </div>
            Data modeling guide
          </div>,
        ),
        description: renderToString(
          <>
            Improve the accuracy of AI predictions by leveraging modeling.
            <br />
            <br />
            {/* TODO: add sample dataset judgement */}
            We use{' '}
            <a
              href="https://docs.getwren.ai/cloud/getting_started/sample_data/ecommerce"
              target="_blank"
              rel="noopener noreferrer"
            >
              E-commerce Dataset
            </a>{' '}
            to present the guide. To know more, Please visit About the
            E-commerce Dataset.
          </>,
        ),
        showButtons: ['next', 'close'],
        onPopoverRender: (popoverDom: DriverPopoverDOM) => {
          popoverDom.wrapper.style.maxWidth = 'none';
          popoverDom.wrapper.style.width = '720px';
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
                src="/images/learning/edit-model.jpg"
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
                width="480"
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
      },
    },
    {
      element: '[data-guideid="deploy-model"]',
      popover: {
        title: renderToString(
          <>
            <div className="-mx-4">
              <img
                className="mb-2"
                src="/images/learning/edit-model.jpg"
                alt="edit-model"
              />
            </div>
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
                src="/images/learning/edit-model.jpg"
                alt="edit-model"
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
          popoverDom.wrapper.style.maxWidth = 'none';
          popoverDom.wrapper.style.width = '720px';
        },
        doneBtnText: 'Go to Home',
        onNextClick: () => {
          router.push(Path.Home);
          $driver.destroy();
        },
      },
    },
  ]);
  $driver.drive();
};
