import { useState } from 'react';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { nextTick } from '@/utils/time';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';

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

const errorData = {
  message: '',
  extensions: {
    code: '000',
    data: {
      status: 'searching',
      message: '',
    },
  },
};

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
  const router = useRouter();
  // TODO: adjust when intergrating with API
  const [simulateData, setSimulateData] = useState(testData);
  const data = [];
  const isDemo = true;

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

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
    <SiderLayout loading={false} sidebar={{ data, onSelect }}>
      <div
        className="d-flex align-center justify-center flex-column"
        style={{ height: '100%' }}
      >
        <img src="https://picsum.photos/45/45" alt="home-logo" />
        <div className="text-md text-medium mt-3">
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
