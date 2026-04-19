import { useMemo } from 'react';
import type { SuggestedQuestionsPayload } from '@/utils/homeRest';
import {
  getReferenceDemoKnowledgeByName,
  getReferenceDisplayKnowledgeName,
  REFERENCE_HOME_RECOMMENDATIONS,
} from '@/utils/referenceDemoKnowledge';
import type { HomeRecommendationCard } from './components/HomeRecommendationSection';

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

type RecommendationAssetSummary = {
  id: string;
  name: string;
  suggestedQuestions?: string[];
};

export function useHomeRecommendations({
  currentKnowledgeBases,
  currentKnowledgeBase,
  selectedKnowledgeBaseIds,
  suggestedQuestionsData,
  knowledgeBaseAssets,
}: {
  currentKnowledgeBases: KnowledgeBaseSummary[];
  currentKnowledgeBase?: KnowledgeBaseSummary | null;
  selectedKnowledgeBaseIds: string[];
  suggestedQuestionsData: SuggestedQuestionsPayload | null;
  knowledgeBaseAssets: RecommendationAssetSummary[];
}) {
  const recommendationKnowledgeBase = useMemo(() => {
    if (selectedKnowledgeBaseIds.length > 0) {
      const selectedKnowledgeBase = currentKnowledgeBases.find(
        (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseIds[0],
      );
      if (selectedKnowledgeBase) {
        return selectedKnowledgeBase;
      }
    }

    return currentKnowledgeBase || null;
  }, [currentKnowledgeBase, currentKnowledgeBases, selectedKnowledgeBaseIds]);

  const recommendationKnowledgeBaseName =
    recommendationKnowledgeBase?.name || '';

  const matchedDemoKnowledge = useMemo(
    () => getReferenceDemoKnowledgeByName(recommendationKnowledgeBaseName),
    [recommendationKnowledgeBaseName],
  );

  const sampleQuestions = useMemo(
    () => suggestedQuestionsData?.questions || [],
    [suggestedQuestionsData],
  );

  const assetRecommendationCards = useMemo<HomeRecommendationCard[]>(() => {
    const assetsWithQuestions = knowledgeBaseAssets
      .map((asset) => ({
        ...asset,
        suggestedQuestions: (asset.suggestedQuestions || [])
          .map((question) => question.trim())
          .filter(Boolean),
      }))
      .filter((asset) => asset.suggestedQuestions.length > 0);

    if (assetsWithQuestions.length === 0) {
      return [];
    }

    const entries: Array<{ question: string; assetName: string }> = [];
    let questionIndex = 0;

    while (entries.length < 3) {
      let consumedQuestion = false;

      for (const asset of assetsWithQuestions) {
        const question = asset.suggestedQuestions[questionIndex];
        if (!question) {
          continue;
        }

        entries.push({
          question,
          assetName: asset.name,
        });
        consumedQuestion = true;

        if (entries.length >= 3) {
          break;
        }
      }

      if (!consumedQuestion) {
        break;
      }

      questionIndex += 1;
    }

    return entries.map((entry, index) => ({
      question: entry.question,
      badge: index === 1 ? '最新' : '热门',
      knowledgeBaseId: recommendationKnowledgeBase?.id,
      knowledgeBaseName: recommendationKnowledgeBase?.name || undefined,
      assetName: entry.assetName,
    }));
  }, [knowledgeBaseAssets, recommendationKnowledgeBase]);

  const fallbackQuestionsForKnowledgeBase = useMemo(() => {
    const displayName = getReferenceDisplayKnowledgeName(
      recommendationKnowledgeBase,
    );

    return [
      `围绕「${displayName}」先看哪些关键指标？`,
      `基于「${displayName}」有哪些值得优先追问的问题？`,
      `「${displayName}」里最适合先验证的业务结论是什么？`,
    ];
  }, [recommendationKnowledgeBase]);

  const scopedFallbackKnowledgeBaseCards = useMemo<HomeRecommendationCard[]>(
    () =>
      recommendationKnowledgeBase
        ? fallbackQuestionsForKnowledgeBase.map((question, index) => ({
            question,
            badge: index === 1 ? '最新' : '热门',
            knowledgeBaseId: recommendationKnowledgeBase.id,
            knowledgeBaseName: recommendationKnowledgeBase.name || undefined,
          }))
        : [],
    [fallbackQuestionsForKnowledgeBase, recommendationKnowledgeBase],
  );

  const workspaceKnowledgeBaseCards = useMemo<HomeRecommendationCard[]>(() => {
    return currentKnowledgeBases.slice(0, 3).map((knowledgeBase, index) => {
      const matchedKnowledge = getReferenceDemoKnowledgeByName(
        knowledgeBase.name || '',
      );
      const displayName = getReferenceDisplayKnowledgeName(knowledgeBase.name);
      const fallbackQuestions = [
        `围绕「${displayName}」先看哪些关键指标？`,
        `基于「${displayName}」有哪些值得优先追问的问题？`,
        `「${displayName}」里最适合先验证的业务结论是什么？`,
      ];

      return {
        question:
          matchedKnowledge?.suggestedQuestions[index] ||
          matchedKnowledge?.suggestedQuestions[0] ||
          fallbackQuestions[index] ||
          fallbackQuestions[0],
        badge: index === 1 ? '最新' : '热门',
        knowledgeBaseId: knowledgeBase.id,
        knowledgeBaseName: knowledgeBase.name || undefined,
      };
    });
  }, [currentKnowledgeBases]);

  const recommendationCards = useMemo<HomeRecommendationCard[]>(() => {
    const scopedCardMeta = recommendationKnowledgeBase
      ? {
          knowledgeBaseId: recommendationKnowledgeBase.id,
          knowledgeBaseName: recommendationKnowledgeBase.name || undefined,
        }
      : {};

    if (assetRecommendationCards.length > 0) {
      return assetRecommendationCards;
    }

    if (matchedDemoKnowledge) {
      const primaryQuestions = matchedDemoKnowledge.suggestedQuestions;
      const fallbackQuestion =
        REFERENCE_HOME_RECOMMENDATIONS[1]?.question ||
        REFERENCE_HOME_RECOMMENDATIONS[0]?.question;

      return [
        {
          question:
            primaryQuestions[0] || REFERENCE_HOME_RECOMMENDATIONS[0].question,
          badge: '热门',
          ...scopedCardMeta,
        },
        {
          question: primaryQuestions[1] || fallbackQuestion,
          badge: '最新',
          ...scopedCardMeta,
        },
        {
          question:
            primaryQuestions[2] || REFERENCE_HOME_RECOMMENDATIONS[2].question,
          badge: '热门',
          ...scopedCardMeta,
        },
      ];
    }

    if (sampleQuestions.length === 0) {
      if (scopedFallbackKnowledgeBaseCards.length > 0) {
        return scopedFallbackKnowledgeBaseCards;
      }
      if (workspaceKnowledgeBaseCards.length > 0) {
        return workspaceKnowledgeBaseCards;
      }
      return REFERENCE_HOME_RECOMMENDATIONS;
    }

    return sampleQuestions
      .filter(
        (item): item is NonNullable<(typeof sampleQuestions)[number]> =>
          item !== null,
      )
      .slice(0, 3)
      .map(
        (
          item: NonNullable<(typeof sampleQuestions)[number]>,
          index: number,
        ) => ({
          question: item.question,
          badge: index === 1 ? '最新' : '热门',
          ...scopedCardMeta,
        }),
      );
  }, [
    assetRecommendationCards,
    matchedDemoKnowledge,
    recommendationKnowledgeBase,
    sampleQuestions,
    scopedFallbackKnowledgeBaseCards,
    workspaceKnowledgeBaseCards,
  ]);

  const recommendationSourceHint = useMemo(() => {
    if (assetRecommendationCards.length > 0) {
      const knowledgeBaseName = getReferenceDisplayKnowledgeName(
        recommendationKnowledgeBase,
      );
      const assetNames = [
        ...new Set(
          assetRecommendationCards
            .map((card) => card.assetName?.trim())
            .filter(Boolean),
        ),
      ];

      if (assetNames.length === 1) {
        return `问题来自「${knowledgeBaseName}」知识库中资产「${assetNames[0]}」的推荐问法，点击后会填入输入框。`;
      }

      return `问题来自「${knowledgeBaseName}」知识库内多个资产的推荐问法，点击后会填入输入框。`;
    }

    if (matchedDemoKnowledge) {
      const displayName = getReferenceDisplayKnowledgeName(
        recommendationKnowledgeBaseName || matchedDemoKnowledge.name,
      );
      return `问题来自「${displayName}」知识库的示例问题，点击后会填入输入框。`;
    }

    if (sampleQuestions.length > 0) {
      return '问题来自当前运行时的样例题库，点击后会填入输入框。';
    }

    if (recommendationKnowledgeBase) {
      const displayName = getReferenceDisplayKnowledgeName(
        recommendationKnowledgeBase,
      );
      return `问题围绕「${displayName}」知识库整理，点击后会填入输入框。`;
    }

    if (workspaceKnowledgeBaseCards.length > 0) {
      return '问题优先来自当前空间的知识库示例，点击后会填入输入框。';
    }

    return '问题来自系统默认模板，可填入输入框后继续提问。';
  }, [
    assetRecommendationCards,
    matchedDemoKnowledge,
    recommendationKnowledgeBase,
    recommendationKnowledgeBaseName,
    sampleQuestions.length,
    workspaceKnowledgeBaseCards.length,
  ]);

  return {
    recommendationCards,
    recommendationSourceHint,
  };
}
