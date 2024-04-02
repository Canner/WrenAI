import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useMemo } from 'react';
import { Path } from '@/utils/enum';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import {
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import useAskPrompt, { getIsFinished } from '@/hooks/useAskPrompt';
import PromptThread from '@/components/pages/home/promptThread';

export default function HomeThread({ threadId }) {
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const askPrompt = useAskPrompt(threadId);

  const {
    data,
    loading,
    updateQuery: updateThreadQuery,
  } = useThreadQuery({
    variables: { threadId },
    fetchPolicy: 'cache-and-network',
    onError: () => router.push(Path.Home),
  });
  const [createThreadResponse] = useCreateThreadResponseMutation({
    onCompleted(next) {
      const nextResponse = next.createThreadResponse;
      updateThreadQuery((prev) => {
        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: [...prev.thread.responses, nextResponse],
          },
        };
      });
    },
  });
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      pollInterval: 1000,
      onCompleted(next) {
        const nextResponse = next.threadResponse;
        updateThreadQuery((prev) => ({
          ...prev,
          thread: {
            ...prev.thread,
            responses: prev.thread.responses.map((response) =>
              response.id === nextResponse.id ? nextResponse : response,
            ),
          },
        }));
      },
    });

  const thread = useMemo(() => data?.thread || null, [data]);
  const threadResponse = useMemo(
    () => threadResponseResult.data?.threadResponse || null,
    [threadResponseResult.data],
  );
  const isFinished = useMemo(
    () => getIsFinished(threadResponse?.status),
    [threadResponse],
  );

  useEffect(() => {
    const unfinishedRespose = (thread?.responses || []).find(
      (response) => !getIsFinished(response.status),
    );

    if (unfinishedRespose) {
      fetchThreadResponse({ variables: { responseId: unfinishedRespose.id } });
    }
  }, [thread]);

  useEffect(() => {
    if (isFinished) threadResponseResult.stopPolling();
  }, [isFinished]);

  const onSelect = async (payload) => {
    try {
      const response = await createThreadResponse({
        variables: { threadId: thread.id, data: payload },
      });
      await fetchThreadResponse({
        variables: { responseId: response.data.createThreadResponse.id },
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SiderLayout loading={loading} sidebar={homeSidebar}>
      <PromptThread data={thread} />
      <div className="py-10" />
      <Prompt
        data={askPrompt.data}
        onSubmit={askPrompt.onSubmit}
        onStop={askPrompt.onStop}
        onSelect={onSelect}
      />
    </SiderLayout>
  );
}

export const getServerSideProps = (async (context) => {
  return {
    props: {
      threadId: Number(context.params.id),
    },
  };
}) as GetServerSideProps<{ threadId: number }>;
