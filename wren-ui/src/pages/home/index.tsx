import Image from 'next/image';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import { useCreateThreadMutation } from '@/apollo/client/graphql/home.generated';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import useAskPrompt from '@/hooks/useAskPrompt';

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

export default function Home() {
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const askPrompt = useAskPrompt();

  const [createThread] = useCreateThreadMutation({
    onCompleted: () => homeSidebar.refetch(),
  });

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
        data={askPrompt.data}
        onSubmit={askPrompt.onSubmit}
        onStop={askPrompt.onStop}
        onSelect={onSelect}
      />
    </SiderLayout>
  );
}
