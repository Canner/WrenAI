import { useEffect, useRef } from 'react';

export const shouldResetKnowledgeStateOnBaseSwitch = ({
  previousKnowledgeBaseId,
  activeKnowledgeBaseId,
}: {
  previousKnowledgeBaseId?: string | null;
  activeKnowledgeBaseId?: string | null;
}) =>
  Boolean(
    previousKnowledgeBaseId &&
      activeKnowledgeBaseId &&
      previousKnowledgeBaseId !== activeKnowledgeBaseId,
  );

export default function useKnowledgeActiveKnowledgeBaseSwitch({
  activeKnowledgeBaseId,
  onKnowledgeBaseChanged,
}: {
  activeKnowledgeBaseId?: string | null;
  onKnowledgeBaseChanged: () => void;
}) {
  const previousKnowledgeBaseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeKnowledgeBaseId) {
      previousKnowledgeBaseIdRef.current = null;
      return;
    }

    if (
      shouldResetKnowledgeStateOnBaseSwitch({
        previousKnowledgeBaseId: previousKnowledgeBaseIdRef.current,
        activeKnowledgeBaseId,
      })
    ) {
      onKnowledgeBaseChanged();
    }

    previousKnowledgeBaseIdRef.current = activeKnowledgeBaseId;
  }, [activeKnowledgeBaseId, onKnowledgeBaseChanged]);
}
