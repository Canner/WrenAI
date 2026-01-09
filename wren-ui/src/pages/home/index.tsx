import { ComponentRef, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { Button, Typography } from 'antd';
import { Logo } from '@/components/Logo';
import { Path } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import DemoPrompt from '@/components/pages/home/prompt/DemoPrompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useAskPrompt from '@/hooks/useAskPrompt';
import useRecommendedQuestionsInstruction from '@/hooks/useRecommendedQuestionsInstruction';
import RecommendedQuestionsPrompt from '@/components/pages/home/prompt/RecommendedQuestionsPrompt';
import {
  useSuggestedQuestionsQuery,
  useCreateThreadMutation,
  useThreadLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { CreateThreadInput } from '@/apollo/client/graphql/__types__';

const { Text } = Typography;

const Wrapper = ({ children }) => {
  return (
    <div
      className="d-flex align-center justify-center flex-column"
      style={{ height: '100%' }}
    >
      <Logo size={48} color="var(--gray-8)" />
      <div className="text-md text-medium gray-8 mt-3">
        Know more about your data
      </div>
      {children}
    </div>
  );
};

const SampleQuestionsInstruction = (props) => {
  const { sampleQuestions, onSelect } = props;

  return (
    <Wrapper>
      <DemoPrompt demo={sampleQuestions} onSelect={onSelect} />
    </Wrapper>
  );
};

function RecommendedQuestionsInstruction(props) {
  const { onSelect, loading } = props;

  const {
    buttonProps,
    generating,
    recommendedQuestions,
    showRetry,
    showRecommendedQuestionsPromptMode,
  } = useRecommendedQuestionsInstruction();

  return showRecommendedQuestionsPromptMode ? (
    <div
      className="d-flex align-center flex-column pt-10"
      style={{ margin: 'auto' }}
    >
      <RecommendedQuestionsPrompt
        recommendedQuestions={recommendedQuestions}
        onSelect={onSelect}
        loading={loading}
      />
      <div className="py-12" />
    </div>
  ) : (
    <Wrapper>
      <Button className="mt-6" {...buttonProps} />
      {generating && (
        <Text className="mt-3 text-sm gray-6">
          Thinking of good questions for you... (about 1 minute)
        </Text>
      )}
      {!generating && showRetry && (
        <Text className="mt-3 text-sm gray-6 text-center">
          We couldn't think of questions right now.
          <br />
          Let's try again later.
        </Text>
      )}
    </Wrapper>
  );
}

import { useHome } from '@/hooks/useHome';

export default function Home() {
  const {
    $prompt,
    homeSidebar,
    askPrompt,
    isSampleDataset,
    sampleQuestions,
    onSelectQuestion,
    onCreateResponse,
    threadCreating,
  } = useHome();

  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      {isSampleDataset && (
        <SampleQuestionsInstruction
          sampleQuestions={sampleQuestions}
          onSelect={onSelectQuestion}
        />
      )}

      {!isSampleDataset && (
        <RecommendedQuestionsInstruction
          onSelect={onCreateResponse}
          loading={threadCreating}
        />
      )}
      <Prompt
        ref={$prompt}
        {...askPrompt}
        onCreateResponse={onCreateResponse}
      />
    </SiderLayout>
  );
}
