import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import {
  useCreateCorrectedThreadResponseMutation,
  useCreateThreadResponseExplainMutation,
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import useAskPrompt, {
  getIsFinished,
  checkExplainExisted,
} from '@/hooks/useAskPrompt';
import useModalAction from '@/hooks/useModalAction';
import Thread from '@/components/pages/home/thread';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import { useCreateViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  CreateCorrectedThreadResponseInput,
  CreateThreadResponseExplainWhereInput,
  CreateThreadResponseInput,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

export default function HomeThread() {
  const router = useRouter();
  const params = useParams();
  const homeSidebar = useHomeSidebar();
  const threadId = useMemo(() => Number(params?.id) || null, [params]);
  const askPrompt = useAskPrompt(threadId);
  const saveAsViewModal = useModalAction();
  const [createViewMutation, { loading: creating }] = useCreateViewMutation({
    onError: (error) => console.error(error),
    onCompleted: () => message.success('Successfully created view.'),
  });

  const {
    data,
    loading,
    updateQuery: updateThreadQuery,
  } = useThreadQuery({
    variables: { threadId },
    fetchPolicy: 'cache-and-network',
    skip: threadId === null,
    onError: () => router.push(Path.Home),
  });
  const addThreadResponse = (nextResponse) => {
    updateThreadQuery((prev) => {
      return {
        ...prev,
        thread: {
          ...prev.thread,
          responses: [...prev.thread.responses, nextResponse],
        },
      };
    });
  };
  const [createThreadResponseExplain] = useCreateThreadResponseExplainMutation({
    onError: (error) => console.error(error),
  });
  const [createThreadResponse] = useCreateThreadResponseMutation({
    onCompleted(next) {
      const nextResponse = next.createThreadResponse;
      addThreadResponse(nextResponse);
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
  const [createRegeneratedThreadResponse] =
    useCreateCorrectedThreadResponseMutation({
      onCompleted(next) {
        const nextResponse = next.createCorrectedThreadResponse;
        addThreadResponse(nextResponse);
      },
    });

  const thread = useMemo(() => data?.thread || null, [data]);
  const threadResponse = useMemo(
    () => threadResponseResult.data?.threadResponse || null,
    [threadResponseResult.data],
  );
  const isFinished = useMemo(
    () =>
      getIsFinished(
        threadResponse?.status,
        checkExplainExisted(threadResponse?.explain),
      ),
    [threadResponse],
  );

  const startThreadResponseExplanation = useCallback(
    (threadResponse: ThreadResponse) => {
      const isSuccessBreakdown = threadResponse?.error === null;
      const isExplainable =
        threadResponse?.explain &&
        threadResponse?.explain?.error === null &&
        threadResponse?.explain.queryId === null;
      if (isSuccessBreakdown && isExplainable) {
        createThreadResponseExplain({
          variables: { where: { responseId: threadResponse.id } },
        }).then(() =>
          fetchThreadResponse({ variables: { responseId: threadResponse.id } }),
        );
      }
    },
    [],
  );

  useEffect(() => {
    const unfinishedResposes = (thread?.responses || []).filter(
      (response) =>
        !getIsFinished(response.status, checkExplainExisted(response?.explain)),
    );
    if (!!unfinishedResposes.length) {
      for (const response of unfinishedResposes) {
        fetchThreadResponse({ variables: { responseId: response.id } });
      }
      // Explanation will be triggered by polling process
      return;
    }

    // If all responses are finished, we need to check if there is any explanation that is not started
    const unfinishedExplanations = (thread?.responses || []).filter(
      (response) => response.explain?.queryId === null,
    );
    for (const response of unfinishedExplanations) {
      startThreadResponseExplanation(response);
    }
  }, [thread]);

  useEffect(() => {
    if (isFinished) {
      threadResponseResult.stopPolling();

      startThreadResponseExplanation(threadResponse);
    }
  }, [isFinished, threadResponse]);

  const onSelect = async (payload: CreateThreadResponseInput) => {
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

  const onSubmitReviewDrawer = async (
    payload: CreateCorrectedThreadResponseInput,
  ) => {
    try {
      const response = await createRegeneratedThreadResponse({
        variables: { threadId: thread.id, data: payload },
      });
      await fetchThreadResponse({
        variables: {
          responseId: response.data.createCorrectedThreadResponse.id,
        },
      });
    } catch (error) {
      throw error;
    }
  };

  const onTriggerThreadResponseExplain = async (
    payload: CreateThreadResponseExplainWhereInput,
  ) => {
    try {
      await createThreadResponseExplain({
        variables: { where: payload },
      });
      await fetchThreadResponse({ variables: payload });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SiderLayout loading={loading} sidebar={homeSidebar}>
      <Thread
        data={thread}
        onOpenSaveAsViewModal={saveAsViewModal.openModal}
        onSubmitReviewDrawer={onSubmitReviewDrawer}
        onTriggerThreadResponseExplain={onTriggerThreadResponseExplain}
      />
      <div className="py-12" />
      <Prompt
        data={askPrompt.data}
        onSubmit={askPrompt.onSubmit}
        onStop={askPrompt.onStop}
        onSelect={onSelect}
      />
      <SaveAsViewModal
        {...saveAsViewModal.state}
        loading={creating}
        onClose={saveAsViewModal.closeModal}
        onSubmit={async (values) => {
          await createViewMutation({
            variables: { data: values },
          });
        }}
      />
    </SiderLayout>
  );
}
