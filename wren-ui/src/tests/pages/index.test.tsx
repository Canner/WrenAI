import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import IndexPage from '../../pages';

const mockUseWithOnboarding = jest.fn();

jest.mock('@/hooks/useCheckOnboarding', () => ({
  useWithOnboarding: () => mockUseWithOnboarding(),
}));

jest.mock('@/components/PageLoading', () => ({
  __esModule: true,
  default: ({ visible }: { visible: boolean }) => (
    <div>{visible ? 'Page Loading Visible' : 'Page Loading Hidden'}</div>
  ),
}));

describe('index route entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses the feature-owned home index page and runs onboarding guard', () => {
    const markup = renderToStaticMarkup(<IndexPage />);

    expect(mockUseWithOnboarding).toHaveBeenCalled();
    expect(markup).toContain('Page Loading Visible');
  });
});
