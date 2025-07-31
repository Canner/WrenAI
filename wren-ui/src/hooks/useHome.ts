import { ComponentRef, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSuggestedQuestionsQuery, useCreateThreadMutation, useThreadLazyQuery } from '@/apollo/client/graphql/home.generated';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { CreateThreadInput } from '@/apollo/client/graphql/__types__';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useAskPrompt from '@/hooks/useAskPrompt';
import { Path } from '@/utils/enum';

export const useHome = () => {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const askPrompt = useAskPrompt();

  const { data: suggestedQuestionsData } = useSuggestedQuestionsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const [createThread, { loading: threadCreating }] = useCreateThreadMutation({
    onError: (error) => console.error(error),
    onCompleted: () => homeSidebar.refetch(),
  });
  const [preloadThread] = useThreadLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  const { data: settingsResult } = useGetSettingsQuery();
  const settings = settingsResult?.settings;
  const isSampleDataset = useMemo(
    () => Boolean(settings?.dataSource?.sampleDataset),
    [settings],
  );

  const sampleQuestions = useMemo(
    () => suggestedQuestionsData?.suggestedQuestions.questions || [],
    [suggestedQuestionsData],
  );

  const onSelectQuestion = async ({ question }) => {
    $prompt.current.submit(question);
  };

  const onCreateResponse = async (payload: CreateThreadInput) => {
    try {
      askPrompt.onStopPolling();
      const response = await createThread({ variables: { data: payload } });
      const threadId = response.data.createThread.id;
      await preloadThread({ variables: { threadId } });
      router.push(Path.Home + `/${threadId}`);
    } catch (error) {
      console.error(error);
    }
  };

  return {
    $prompt,
    homeSidebar,
    askPrompt,
    isSampleDataset,
    sampleQuestions,
    onSelectQuestion,
    onCreateResponse,
    threadCreating,
  };
};