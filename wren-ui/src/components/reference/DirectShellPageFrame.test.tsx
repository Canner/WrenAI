import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DirectShellPageFrame from './DirectShellPageFrame';

const mockUsePersistentShellEmbedded = jest.fn();
const mockUseHomeSidebar = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();

jest.mock('./PersistentShellContext', () => ({
  __esModule: true,
  usePersistentShellEmbedded: () => mockUsePersistentShellEmbedded(),
}));

jest.mock('@/hooks/useHomeSidebar', () => ({
  __esModule: true,
  default: () => mockUseHomeSidebar(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('./DolaAppShell', () => ({
  __esModule: true,
  default: ({ children, historyItems, navItems }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      {
        'data-nav-count': navItems?.length || 0,
        'data-history-count': historyItems?.length || 0,
      },
      children,
    );
  },
}));

describe('DirectShellPageFrame', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePersistentShellEmbedded.mockReturnValue(false);
    mockUseHomeSidebar.mockReturnValue({
      data: {
        threads: [{ id: 'thread-1', name: '经营分析' }],
      },
      loading: false,
      ensureLoaded: jest.fn(),
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      pushWorkspace: jest.fn(),
    });
  });

  it('wraps direct pages with shell chrome when not embedded', () => {
    const html = renderToStaticMarkup(
      <DirectShellPageFrame activeNav="home">
        <div>page-content</div>
      </DirectShellPageFrame>,
    );

    expect(html).toContain('page-content');
    expect(html).toContain('data-nav-count="3"');
    expect(html).toContain('data-history-count="1"');
  });

  it('returns raw page content when already embedded', () => {
    mockUsePersistentShellEmbedded.mockReturnValue(true);

    const html = renderToStaticMarkup(
      <DirectShellPageFrame activeNav="knowledge">
        <div>embedded-content</div>
      </DirectShellPageFrame>,
    );

    expect(html).toContain('embedded-content');
    expect(html).not.toContain('data-nav-count');
  });
});
