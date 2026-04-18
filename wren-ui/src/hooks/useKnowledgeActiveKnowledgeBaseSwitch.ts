import { useEffect, useRef } from 'react';

export const shouldResetKnowledgeStateOnBaseSwitch = ({
  previousKnowledgeBaseId,
  activeKnowledgeBaseId,
  switchReady = true,
}: {
  previousKnowledgeBaseId?: string | null;
  activeKnowledgeBaseId?: string | null;
  switchReady?: boolean;
}) =>
  Boolean(
    switchReady &&
    previousKnowledgeBaseId &&
      activeKnowledgeBaseId &&
      previousKnowledgeBaseId !== activeKnowledgeBaseId,
  );

export default function useKnowledgeActiveKnowledgeBaseSwitch({
  activeKnowledgeBaseId,
  switchReady = true,
  onKnowledgeBaseChanged,
}: {
  activeKnowledgeBaseId?: string | null;
  switchReady?: boolean;
  onKnowledgeBaseChanged: () => void;
}) {
  const previousKnowledgeBaseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeKnowledgeBaseId) {
      if (switchReady) {
        previousKnowledgeBaseIdRef.current = null;
      }
      return;
    }

    if (!switchReady) {
      return;
    }

    if (
      shouldResetKnowledgeStateOnBaseSwitch({
        previousKnowledgeBaseId: previousKnowledgeBaseIdRef.current,
        activeKnowledgeBaseId,
        switchReady,
      })
    ) {
      onKnowledgeBaseChanged();
    }

    previousKnowledgeBaseIdRef.current = activeKnowledgeBaseId;
  }, [activeKnowledgeBaseId, onKnowledgeBaseChanged, switchReady]);
}
