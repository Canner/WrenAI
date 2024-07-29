import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { sortBy } from 'lodash';
import { Skeleton } from 'antd';
import ReferenceSideFloat from '@/components/pages/home/thread/feedback/ReferenceSideFloat';
import FeedbackSideFloat from '@/components/pages/home/thread/feedback/FeedbackSideFloat';
import ReviewDrawer from '@/components/pages/home/thread/feedback/ReviewDrawer';
import useDrawerAction from '@/hooks/useDrawerAction';
import { ThreadResponse } from '@/apollo/client/graphql/__types__';
import { Reference, REFERENCE_ORDERS } from './utils';
import { getIsExplainFinished } from '@/hooks/useAskPrompt';

type ContextProps = {
  references: Reference[];
  sqlTargetReference?: Reference;
  onHighlightToReferences: (target?: Reference) => void;
} | null;

export const FeedbackContext = createContext<ContextProps>({
  references: [],
  sqlTargetReference: null,
  onHighlightToReferences: () => {},
});

export const useFeedbackContext = () => {
  return useContext(FeedbackContext);
};

interface Props {
  headerSlot: React.ReactNode;
  bodySlot: React.ReactNode;
  threadResponse: ThreadResponse;
  onSubmitReviewDrawer: (variables: any) => Promise<void>;
  onTriggerThreadResponseExplain: (variables: any) => Promise<void>;
}

export default function Feedback(props: Props) {
  const {
    headerSlot,
    bodySlot,
    threadResponse,
    onSubmitReviewDrawer,
    onTriggerThreadResponseExplain,
  } = props;

  const reviewSideFloat = useRef(null);
  const [sqlTargetReference, setSqlTargetReference] =
    useState<Reference | null>();
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

  const triggerExplanation = () => {
    onTriggerThreadResponseExplain({ responseId: threadResponse.id });
  };

  const hoverReference = (reference?: Reference) => {
    setSqlTargetReference(reference);
  };

  const loading = useMemo(
    () => !getIsExplainFinished(threadResponse?.explain?.status),
    [threadResponse?.explain?.status],
  );
  const error = useMemo(() => {
    return threadResponse?.explain?.error || null;
  }, [threadResponse?.explain?.error]);
  const references = useMemo(() => {
    if (!threadResponse?.detail) return [];
    const result = threadResponse.detail.steps.flatMap((step, index) => {
      if (step.references === null) return [];
      return step.references.map((reference) => ({
        ...reference,
        stepIndex: index,
        correctionPrompt: correctionPrompts[reference.referenceId],
      }));
    });
    // Generate reference number for each reference
    return sortBy(result, (reference) =>
      REFERENCE_ORDERS.indexOf(reference.type),
    ).map((reference, index) => ({
      referenceNum: index + 1,
      ...reference,
    }));
  }, [threadResponse?.detail, correctionPrompts]);

  const contextValue = {
    references,
    sqlTargetReference,
    onHighlightToReferences: (target) => {
      if (reviewSideFloat.current) {
        reviewSideFloat.current?.triggerHighlight(target);
      }
    },
  };

  return (
    <FeedbackContext.Provider value={contextValue}>
      <div className="d-flex">
        {headerSlot}
        <div className="flex-shrink-0 flex-grow-1 pl-5" style={{ width: 330 }}>
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
        <div className="flex-shrink-0 flex-grow-1 pl-5" style={{ width: 330 }}>
          <Skeleton active loading={loading}>
            <ReferenceSideFloat
              ref={reviewSideFloat}
              references={references}
              error={error}
              onSaveCorrectionPrompt={saveCorrectionPrompt}
              onTriggerExplanation={triggerExplanation}
              onHoverReference={hoverReference}
            />
          </Skeleton>
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
