import type { NextRouter } from 'next/router';

import {
  playDataModelingGuide,
  playSwitchProjectLanguageGuide,
} from './guideFlowStories';
import {
  playKnowledgeGuide,
  playSaveToKnowledgeGuide,
} from './knowledgeGuideStories';
import type { StoryPayload } from './storyTypes';
import { Dispatcher, DriverObj, LEARNING } from './utils';

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
