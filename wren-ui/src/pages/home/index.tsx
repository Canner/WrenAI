import { useState } from 'react';
import { nextTick } from '@/utils/time';
import Image from 'next/image';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';

const testData = {
  status: 'searching',
  result: [
    {
      summary: 'Top 10 customer with most order from global customer in 2024',
      sql: 'SELECT * FROM customer',
    },
    {
      summary: 'Top 10 customer with most order from global customer in 2024',
      sql: 'SELECT * FROM customer',
    },
    {
      summary: 'Top 10 customer with most order from global customer in 2024',
      sql: 'SELECT * FROM customer',
    },
  ],
};

const errorData = undefined;
// {
//   message: '',
//   extensions: {
//     code: '000',
//     data: {
//       status: 'finished',
//       // message: `Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: 10\n     at Main.main(Main.java:4)`,
//     },
//   },
// };

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

export default function Ask() {
  const { loading } = useWithOnboarding();
  const homeSidebar = useHomeSidebar();

  // TODO: adjust when intergrating with API
  const [simulateData, setSimulateData] = useState(testData);
  const isDemo = true;

  const onDemoSelect = () => {};

  const onStop = () => {
    // TODO: send stop asking API
  };

  const simulateProcess = async () => {
    setSimulateData({ ...simulateData, status: 'understanding' });
    await nextTick(3000);
    setSimulateData({ ...simulateData, status: 'searching' });
    await nextTick(3000);
    setSimulateData({ ...simulateData, status: 'finished' });
  };

  const onSubmit = async (value) => {
    console.log(value);
    await simulateProcess();
  };

  return (
    <SiderLayout loading={loading} sidebar={homeSidebar}>
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
        data={simulateData}
        error={errorData?.extensions.data}
        onSubmit={onSubmit}
        onStop={onStop}
      />
    </SiderLayout>
  );
}
