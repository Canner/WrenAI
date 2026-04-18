import { PROCESS_STATE } from '@/utils/enum';
import { AskingTaskType } from '@/types/home';

export const shouldCreateThreadResponseForPromptState = ({
  type,
  processState,
}: {
  type?: AskingTaskType | null;
  processState: PROCESS_STATE;
}) => {
  const resolvedType = type || AskingTaskType.TEXT_TO_SQL;
  return (
    resolvedType === AskingTaskType.TEXT_TO_SQL &&
    processState !== PROCESS_STATE.UNDERSTANDING
  );
};
