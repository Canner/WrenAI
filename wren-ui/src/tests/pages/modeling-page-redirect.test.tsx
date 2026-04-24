import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Path } from '@/utils/enum';
import ModelingPage from '../../pages/modeling';

const mockUseRouter = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('antd', () => ({
  Skeleton: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'RedirectSkeleton');
  },
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

describe('/modeling compatibility page', () => {
  const replace = jest.fn().mockResolvedValue(true);

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockClear();
    mockUseRouter.mockReturnValue({
      isReady: true,
      query: {
        viewId: '42',
        openMetadata: '1',
        openAssistant: 'relationships',
      },
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      replace,
    });
  });

  it('redirects to knowledge workbench modeling section and preserves deep-link params', () => {
    const useEffectSpy = jest
      .spyOn(React, 'useEffect')
      .mockImplementationOnce(((effect: () => void) => effect()) as any);

    renderToStaticMarkup(<ModelingPage />);

    expect(replace).toHaveBeenCalledWith(Path.Knowledge, {
      section: 'modeling',
      viewId: '42',
      openAssistant: 'relationships',
      openMetadata: '1',
    });

    useEffectSpy.mockRestore();
  });
});
