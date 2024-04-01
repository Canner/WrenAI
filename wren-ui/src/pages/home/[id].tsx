import { GetServerSideProps } from 'next';
import { useEffect, useMemo, useRef } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import SiderLayout from '@/components/layouts/SiderLayout';
import AnswerResult from '@/components/pages/home/AnswerResult';
import Prompt from '@/components/pages/home/prompt';
import { makeIterable } from '@/utils/iteration';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import { AskingTaskStatus } from '@/apollo/client/graphql/__types__';
import { THREAD } from '@/apollo/client/graphql/home';

const AnswerResultsBlock = styled.div`
  width: 768px;
  margin-left: auto;
  margin-right: auto;

  h4.ant-typography {
    margin-top: 10px;
  }

  .ant-typography pre {
    border: none;
    border-radius: 4px;
  }

  .ace_editor {
    border: none;
  }

  button {
    vertical-align: middle;
  }
`;

const checkIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.Finished,
    AskingTaskStatus.Failed,
    AskingTaskStatus.Stopped,
  ].includes(status);

const AnswerBlockTemplate = ({ index, id, status, question, detail }) => {
  return (
    <div key={`${id}-${index}`}>
      {index > 0 && <Divider />}
      <AnswerResult
        answerResultSteps={detail?.steps}
        description={detail?.description}
        loading={status !== AskingTaskStatus.Finished}
        question={question}
        fullSql={detail?.sql}
      />
    </div>
  );
};

const AnswerBlockIterator = makeIterable(AnswerBlockTemplate);

export default function HomeThread({ threadId }) {
  const divRef = useRef<HTMLDivElement>(null);
  const homeSidebar = useHomeSidebar();

  const { data, client } = useThreadQuery({
    variables: { threadId },
    fetchPolicy: 'cache-and-network',
  });

  const thread = useMemo(() => data?.thread || null, [data]);

  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation();
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: 1000,
  });
  const [createThreadResponse] = useCreateThreadResponseMutation({
    onCompleted(_data) {
      const threadQuery = {
        query: THREAD,
        variables: { threadId },
      };
      const current = client.readQuery(threadQuery);
      client.writeQuery({
        ...threadQuery,
        data: {
          thread: {
            ...current.thread,
            responses: [
              ...current.thread.responses,
              _data.createThreadResponse,
            ],
          },
        },
      });
    },
  });
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      pollInterval: 1000,
      onCompleted(_data) {
        const threadQuery = {
          query: THREAD,
          variables: { threadId },
        };
        const current = client.readQuery(threadQuery);
        client.writeQuery({
          ...threadQuery,
          data: {
            thread: {
              ...current.thread,
              responses: current.thread.responses.map((response) => {
                if (response.id === _data.threadResponse.id) {
                  return _data.threadResponse;
                }
                return response;
              }),
            },
          },
        });
      },
    });

  const threadResponse = useMemo(
    () => threadResponseResult.data?.threadResponse || null,
    [threadResponseResult.data],
  );
  useEffect(() => {
    if (!thread) return;
    const unfinishedRespose = thread.responses.find(
      (response) => !checkIsFinished(response.status),
    );

    if (unfinishedRespose) {
      fetchThreadResponse({ variables: { responseId: unfinishedRespose.id } });
    }
  }, [thread]);

  useEffect(() => {
    if (!threadResponse) return;
    if (threadResponse.status && checkIsFinished(threadResponse.status)) {
      threadResponseResult.stopPolling();
    }
  }, [threadResponse]);

  useEffect(() => {
    const { askingTask } = askingTaskResult.data || {};
    if (askingTask?.status && checkIsFinished(askingTask.status)) {
      askingTaskResult.stopPolling();
    }
  }, [askingTaskResult.data?.askingTask]);

  useEffect(() => {
    if (divRef.current && thread?.responses.length > 0) {
      const contentLayout = divRef.current.parentElement;
      const lastChild = divRef.current.lastElementChild as HTMLElement;
      const lastChildDivider = lastChild.firstElementChild as HTMLElement;
      if (
        contentLayout.clientHeight <
        lastChild.offsetTop + lastChild.clientHeight
      ) {
        contentLayout.scrollTo({
          top: lastChildDivider.offsetTop,
          behavior: 'smooth',
        });
      }
    }
  }, [divRef, thread]);

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

  const onStop = () => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId) {
      cancelAskingTask({ variables: { taskId } });
    }
  };

  const onSubmit = async (value) => {
    try {
      const response = await createAskingTask({
        variables: { data: { question: value, threadId } },
      });
      await fetchAskingTask({
        variables: { taskId: response.data.createAskingTask.id },
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      <AnswerResultsBlock className="mt-12 mb-15" ref={divRef}>
        <AnswerBlockIterator data={thread?.responses || []} sql={thread?.sql} />
      </AnswerResultsBlock>
      <Prompt
        data={askingTaskResult.data?.askingTask}
        onSelect={onSelect}
        onSubmit={onSubmit}
        onStop={onStop}
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
