import { useEffect } from 'react';
import Image from 'next/image';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
  useCreateThreadMutation,
} from '@/apollo/client/graphql/home.generated';
import { AskingTaskStatus } from '@/apollo/client/graphql/__types__';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';

const demoData = [
  {
    title: 'General question',
    summary: 'Show me top 10 best-selling product last month.',
  },
  {
    title: 'Drill into metrics',
    summary:
      'List the name of the users who successfully convert to paying customers last week.',
  },
  {
    title: 'Aggregate data',
    summary:
      "Help me categorize customers' ages into groups segmented by every 10 years.",
  },
];

const checkIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.Finished,
    AskingTaskStatus.Failed,
    AskingTaskStatus.Stopped,
  ].includes(status);

export default function Home() {
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation();
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: 1000,
  });
  const [createThread] = useCreateThreadMutation({
    onCompleted: () => homeSidebar.refetch(),
  });

  useEffect(() => {
    const { askingTask } = askingTaskResult.data || {};
    if (askingTask?.status && checkIsFinished(askingTask.status)) {
      askingTaskResult.stopPolling();
    }
  }, [askingTaskResult.data?.askingTask]);

  const isDemo = true;

  const onDemoSelect = () => {};

  const onSelect = async (payload) => {
    try {
      const response = await createThread({ variables: { data: payload } });
      router.push(Path.Home + `/${response.data.createThread.id}`);
    } catch (error) {
      console.error(error);
    }
  };

  const onStop = () => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId) {
      cancelAskingTask({
        variables: { taskId },
      });
    }
  };

  const onSubmit = async (value: string) => {
    try {
      const response = await createAskingTask({
        variables: { data: { question: value } },
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
      <div
        className="d-flex align-center justify-center flex-column"
        style={{ height: '100%' }}
      >
        <Image
          src="/images/logo.svg"
          width="41"
          height="48"
          alt="logo"
          style={{ opacity: 0.6 }}
        />
        <div className="text-md text-medium gray-8 mt-3">
          Know more about your data
        </div>

        {isDemo && <DemoPrompt demo={demoData} onSelect={onDemoSelect} />}
      </div>
      <Prompt
        data={askingTaskResult.data?.askingTask}
        onSelect={onSelect}
        onSubmit={onSubmit}
        onStop={onStop}
      />
    </SiderLayout>
  );
}
