export const getRecommendationTriggerLabel = (locale?: string | null) => {
  const normalizedLocale = (locale || '').trim().toLowerCase();

  if (normalizedLocale.startsWith('en')) {
    return 'Recommend follow-up questions';
  }

  return '推荐几个问题给我';
};
