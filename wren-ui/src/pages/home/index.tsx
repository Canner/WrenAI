import { ComponentRef, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { Path } from '@/utils/enum';
import { nextTick } from '@/utils/time';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useAskPrompt from '@/hooks/useAskPrompt';
import {
  useSuggestedQuestionsQuery,
  useCreateThreadMutation,
} from '@/apollo/client/graphql/home.generated';

export default function Home() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const askPrompt = useAskPrompt();

  const { data: suggestedQuestionsData } = useSuggestedQuestionsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const [createThread] = useCreateThreadMutation({
    onCompleted: () => homeSidebar.refetch(),
  });

  const sampleQuestions = useMemo(
    () => suggestedQuestionsData?.suggestedQuestions.questions || [],
    [suggestedQuestionsData],
  );

  const isSampleDataset = sampleQuestions.length > 0;

  const onDemoSelect = async ({ question }) => {
    $prompt.current.setValue(question);
    await nextTick();
    $prompt.current.submit();
  };

  const onSelect = async (payload) => {
    try {
      const response = await createThread({ variables: { data: payload } });
      router.push(Path.Home + `/${response.data.createThread.id}`);
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

        {isSampleDataset && (
          <DemoPrompt demo={sampleQuestions} onSelect={onDemoSelect} />
        )}
      </div>
      <Prompt
        ref={$prompt}
        data={askPrompt.data}
        onSubmit={askPrompt.onSubmit}
        onStop={askPrompt.onStop}
        onSelect={onSelect}
      />
    </SiderLayout>
  );
}
