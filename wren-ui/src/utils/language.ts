import { ProjectLanguage } from '@/apollo/client/graphql/__types__';

export const getLanguageText = (language: ProjectLanguage) =>
  ({
    [ProjectLanguage.EN]: 'English',
    [ProjectLanguage.ES]: 'Spanish',
    [ProjectLanguage.FR]: 'French',
    [ProjectLanguage.ZH_TW]: 'Traditional Chinese',
    [ProjectLanguage.ZH_CN]: 'Simplified Chinese',
    [ProjectLanguage.DE]: 'German',
    [ProjectLanguage.PT]: 'Portuguese',
    [ProjectLanguage.RU]: 'Russian',
    [ProjectLanguage.JA]: 'Japanese',
    [ProjectLanguage.KO]: 'Korean',
  })[language] || language;
