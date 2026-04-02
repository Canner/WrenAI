import { useApolloClient } from '@apollo/client';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';

export default function useRuntimeScopeTransition() {
  const client = useApolloClient();
  const router = useRouter();
  const [transitioning, setTransitioning] = useState(false);

  const transitionTo = useCallback(
    async (nextUrl: string) => {
      if (!nextUrl || nextUrl === router.asPath) {
        return;
      }

      setTransitioning(true);
      try {
        const navigated = await router.push(nextUrl);
        if (!navigated) {
          return;
        }

        await client.resetStore();
      } finally {
        setTransitioning(false);
      }
    },
    [client, router],
  );

  return {
    transitioning,
    transitionTo,
  };
}
