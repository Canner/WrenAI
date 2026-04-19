import type { ComponentProps } from 'react';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import AdjustReasoningStepsModal from '@/components/modals/AdjustReasoningStepsModal';
import AdjustSQLModal from '@/components/modals/AdjustSQLModal';

type ThreadPageOverlaysProps = {
  saveAsViewModalProps: ComponentProps<typeof SaveAsViewModal>;
  questionSqlPairModalProps: ComponentProps<typeof QuestionSQLPairModal>;
  adjustReasoningStepsModalProps: ComponentProps<
    typeof AdjustReasoningStepsModal
  >;
  adjustSqlModalProps: ComponentProps<typeof AdjustSQLModal>;
};

export default function ThreadPageOverlays({
  saveAsViewModalProps,
  questionSqlPairModalProps,
  adjustReasoningStepsModalProps,
  adjustSqlModalProps,
}: ThreadPageOverlaysProps) {
  return (
    <>
      <SaveAsViewModal {...saveAsViewModalProps} />
      <QuestionSQLPairModal {...questionSqlPairModalProps} />
      <AdjustReasoningStepsModal {...adjustReasoningStepsModalProps} />
      <AdjustSQLModal {...adjustSqlModalProps} />
    </>
  );
}
