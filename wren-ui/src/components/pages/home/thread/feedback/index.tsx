import { createContext, useContext, useMemo, useState } from 'react';
import ReferenceSideFloat from '@/components/pages/home/thread/feedback/ReferenceSideFloat';
import FeedbackSideFloat from '@/components/pages/home/thread/feedback/FeedbackSideFloat';
import ReviewDrawer from '@/components/pages/home/thread/feedback/ReviewDrawer';
import useDrawerAction from '@/hooks/useDrawerAction';
import { ThreadResponse } from '@/apollo/client/graphql/__types__';
import { Reference } from './utils';

type ContextProps = {
  references: Reference[];
} | null;

export const FeedbackContext = createContext<ContextProps>({
  references: [],
});

export const useFeedbackContext = () => {
  return useContext(FeedbackContext);
};

interface Props {
  headerSlot: React.ReactNode;
  bodySlot: React.ReactNode;
  threadResponse: ThreadResponse;
  onSubmitReviewDrawer: (variables: any) => Promise<void>;
}

export default function Feedback(props: Props) {
  const { headerSlot, bodySlot, threadResponse, onSubmitReviewDrawer } = props;

  const [correctionPrompts, setCorrectionPrompts] = useState({});
  const reviewDrawer = useDrawerAction();

  const saveCorrectionPrompt = (id: string, value: string) => {
    setCorrectionPrompts({ ...correctionPrompts, [id]: value });
  };

  const removeCorrectionPrompt = (id: string) => {
    setCorrectionPrompts({ ...correctionPrompts, [id]: undefined });
  };

  const resetAllCorrectionPrompts = () => {
    setCorrectionPrompts({});
  };

  const references = useMemo(() => {
    if (!threadResponse?.detail) return [];
    return threadResponse.detail.steps.flatMap((step, index) => {
      if (step.references === null) return [];
      return step.references.map((reference) => ({
        ...reference,
        id: reference.referenceId,
        stepIndex: index,
        correctionPrompt: correctionPrompts[reference.referenceId],
      }));
    });
  }, [threadResponse?.detail, correctionPrompts]);

  const contextValue = {
    references,
  };

  return (
    <FeedbackContext.Provider value={contextValue}>
      <div className="d-flex">
        {headerSlot}
        <div className="flex-shrink-0 pl-5">
          <FeedbackSideFloat
            className="mb-4"
            references={references}
            onOpenReviewDrawer={reviewDrawer.openDrawer}
            onResetAllCorrectionPrompts={resetAllCorrectionPrompts}
          />
        </div>
      </div>
      <div className="d-flex">
        {bodySlot}
        <div className="flex-shrink-0 pl-5">
          <ReferenceSideFloat
            references={references}
            onSaveCorrectionPrompt={saveCorrectionPrompt}
          />
        </div>
      </div>
      <ReviewDrawer
        {...reviewDrawer.state}
        onClose={reviewDrawer.closeDrawer}
        threadResponseId={threadResponse.id}
        references={references}
        onSubmit={onSubmitReviewDrawer}
        onSaveCorrectionPrompt={saveCorrectionPrompt}
        onRemoveCorrectionPrompt={removeCorrectionPrompt}
        onResetAllCorrectionPrompts={resetAllCorrectionPrompts}
      />
    </FeedbackContext.Provider>
  );
}
