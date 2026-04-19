import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createCompatibilityAliasPage,
  createCompatibilityRedirect,
  createCompatibilityRuntimeRedirectPage,
} from './compatibilityRoutes';

const mockUseRouter = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

describe('compatibilityRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates alias pages that render the canonical page', () => {
    const CanonicalPage = ({ label }: { label: string }) => <div>{label}</div>;
    const AliasPage = createCompatibilityAliasPage(CanonicalPage, {
      legacyRoute: '/legacy',
      canonicalRoute: '/canonical',
    });

    const markup = renderToStaticMarkup(<AliasPage label="Hello alias" />);

    expect(markup).toContain('Hello alias');
    expect(AliasPage.displayName).toBe(
      'CompatibilityAliasPage(/legacy→/canonical)',
    );
  });

  it('creates server redirects for compatibility routes', async () => {
    const getServerSideProps = createCompatibilityRedirect('/settings');

    await expect(getServerSideProps({} as any)).resolves.toEqual({
      redirect: {
        destination: '/settings',
        permanent: false,
      },
    });
  });

  it('creates runtime-aware redirect pages that preserve derived query params', () => {
    const replace = jest.fn().mockResolvedValue(true);
    mockUseRouter.mockReturnValue({
      isReady: true,
      query: { viewId: '42' },
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      replace,
    });

    const RedirectPage = createCompatibilityRuntimeRedirectPage({
      legacyRoute: '/modeling',
      canonicalRoute: '/knowledge',
      buildQuery: (query) => ({
        section: 'modeling',
        viewId: String(query?.viewId || ''),
      }),
      fallback: <div>Redirecting…</div>,
    });

    const useEffectSpy = jest
      .spyOn(React, 'useEffect')
      .mockImplementationOnce(((effect: () => void) => effect()) as any);

    const markup = renderToStaticMarkup(<RedirectPage />);

    expect(markup).toContain('Redirecting…');
    expect(replace).toHaveBeenCalledWith('/knowledge', {
      section: 'modeling',
      viewId: '42',
    });
    expect(RedirectPage.displayName).toBe(
      'CompatibilityRuntimeRedirectPage(/modeling→/knowledge)',
    );

    useEffectSpy.mockRestore();
  });
});
