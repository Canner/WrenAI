import { useMemo } from 'react';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import { peekKnowledgeBaseList } from '@/utils/runtimePagePrefetch';

export const resolveKnowledgeBaseListSelector = ({
  workspaceId,
}: {
  workspaceId?: string | null;
}) => (workspaceId ? { workspaceId } : {});

export const resolveKnowledgeBasesUrl = ({
  hasRuntimeScope,
  workspaceId,
}: {
  hasRuntimeScope: boolean;
  workspaceId?: string | null;
}) =>
  hasRuntimeScope && workspaceId
    ? buildRuntimeScopeUrl(
        '/api/v1/knowledge/bases',
        {},
        resolveKnowledgeBaseListSelector({ workspaceId }),
      )
    : null;

export const resolveCachedKnowledgeBaseList = <T>(
  knowledgeBasesUrl?: string | null,
) => {
  return knowledgeBasesUrl
    ? peekKnowledgeBaseList<T[]>(knowledgeBasesUrl)
    : null;
};

export default function useKnowledgeBaseListCache<T>({
  hasRuntimeScope,
  workspaceId,
}: {
  hasRuntimeScope: boolean;
  workspaceId?: string | null;
}) {
  const knowledgeBasesUrl = useMemo(
    () => resolveKnowledgeBasesUrl({ hasRuntimeScope, workspaceId }),
    [hasRuntimeScope, workspaceId],
  );
  const cachedKnowledgeBaseList = useMemo(
    () => resolveCachedKnowledgeBaseList<T>(knowledgeBasesUrl),
    [knowledgeBasesUrl],
  );

  return {
    knowledgeBasesUrl,
    cachedKnowledgeBaseList,
  };
}
