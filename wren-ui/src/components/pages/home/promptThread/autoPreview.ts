export const resolveShouldAutoPreviewThreadResponse = ({
  responseId,
  isLastThreadResponse,
  initialBlockedPreviewResponseId,
}: {
  responseId: number;
  isLastThreadResponse: boolean;
  initialBlockedPreviewResponseId: number | null;
}) => isLastThreadResponse && responseId !== initialBlockedPreviewResponseId;
