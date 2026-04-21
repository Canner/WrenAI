import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { NextRouter } from 'next/router';

export const replaceKnowledgeRouteWithShallow = (
  router: Pick<NextRouter, 'replace'>,
  nextUrl: string,
) =>
  router.replace(nextUrl, undefined, {
    shallow: true,
    scroll: false,
  });

export const clearKnowledgeDetailAsset = <TAsset>(
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>,
) => {
  setDetailAsset(null);
};

export default function useKnowledgeRouteActions<TAsset>({
  router,
  setDetailAsset,
}: {
  router: Pick<NextRouter, 'replace'>;
  setDetailAsset: Dispatch<SetStateAction<TAsset | null>>;
}) {
  const replaceKnowledgeRoute = useCallback(
    (nextUrl: string) => replaceKnowledgeRouteWithShallow(router, nextUrl),
    [router.replace],
  );
  const clearDetailAsset = useCallback(
    () => clearKnowledgeDetailAsset(setDetailAsset),
    [setDetailAsset],
  );

  return {
    replaceKnowledgeRoute,
    clearDetailAsset,
  };
}
