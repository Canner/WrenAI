import {
  useEffect,
  createElement,
  type ComponentType,
  type ReactElement,
} from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import type { ParsedUrlQuery } from 'querystring';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

export type CompatibilityRouteMeta = {
  legacyRoute: string;
  canonicalRoute: string;
};

type CompatibilityClientRedirectQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

export const createCompatibilityAliasPage = <P extends object>(
  CanonicalPage: ComponentType<P>,
  meta: CompatibilityRouteMeta,
) => {
  const CompatibilityAliasPage = (props: P): ReactElement =>
    createElement(CanonicalPage, props);

  CompatibilityAliasPage.displayName = `CompatibilityAliasPage(${meta.legacyRoute}→${meta.canonicalRoute})`;

  return CompatibilityAliasPage;
};

export const createCompatibilityRedirect =
  (canonicalRoute: string): GetServerSideProps =>
  async () => ({
    redirect: {
      destination: canonicalRoute,
      permanent: false,
    },
  });

export const createCompatibilityRuntimeRedirectPage = ({
  legacyRoute,
  canonicalRoute,
  buildQuery,
  fallback,
}: CompatibilityRouteMeta & {
  buildQuery?: (
    query?: ParsedUrlQuery | Record<string, unknown>,
  ) => CompatibilityClientRedirectQuery;
  fallback?: ReactElement;
}) => {
  const CompatibilityRuntimeRedirectPage = (): ReactElement | null => {
    const router = useRouter();
    const runtimeScopeNavigation = useRuntimeScopeNavigation();

    useEffect(() => {
      if (!router.isReady) {
        return;
      }

      void runtimeScopeNavigation.replace(
        canonicalRoute,
        buildQuery?.(router.query),
      );
    }, [
      buildQuery,
      canonicalRoute,
      router.isReady,
      router.query,
      runtimeScopeNavigation,
    ]);

    return fallback ?? null;
  };

  CompatibilityRuntimeRedirectPage.displayName = `CompatibilityRuntimeRedirectPage(${legacyRoute}→${canonicalRoute})`;

  return CompatibilityRuntimeRedirectPage;
};

export function CompatibilityRedirectPage() {
  return null;
}
