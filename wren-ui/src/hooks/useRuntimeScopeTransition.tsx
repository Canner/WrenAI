import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';

const resolvePathname = (url: string) => {
  try {
    return new URL(url, 'http://wren.local').pathname;
  } catch {
    return '';
  }
};

export default function useRuntimeScopeTransition() {
  const router = useRouter();
  const [transitioning, setTransitioning] = useState(false);

  const transitionTo = useCallback(
    async (nextUrl: string) => {
      if (!nextUrl || nextUrl === router.asPath) {
        return;
      }

      setTransitioning(true);
      try {
        const currentPathname = resolvePathname(router.asPath);
        const nextPathname = resolvePathname(nextUrl);
        const samePathname =
          Boolean(currentPathname) &&
          Boolean(nextPathname) &&
          currentPathname === nextPathname;
        const navigate = samePathname ? router.replace : router.push;
        const navigated = await navigate(nextUrl, undefined, {
          scroll: false,
          shallow: samePathname,
        });
        if (!navigated) {
          return;
        }
      } finally {
        setTransitioning(false);
      }
    },
    [router],
  );

  return {
    transitioning,
    transitionTo,
  };
}
