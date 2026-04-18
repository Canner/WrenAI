import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Modeling from './Modeling';

const mockUseRuntimeScopeNavigation = jest.fn();
let capturedModelTreeProps: any = null;

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('./modeling/ModelTree', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedModelTreeProps = props;
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'model-tree');
  },
}));

jest.mock('./modeling/ViewTree', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'view-tree');
  },
}));

describe('components/sidebar/Modeling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedModelTreeProps = null;
  });

  it('disables schema-change controls when runtime scope is not executable', () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
    });

    renderToStaticMarkup(
      <Modeling
        data={{ models: [], views: [] } as any}
        onOpenModelDrawer={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(capturedModelTreeProps?.schemaChangeEnabled).toBe(false);
  });

  it('keeps schema-change controls enabled for executable runtime scope', () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      },
    });

    renderToStaticMarkup(
      <Modeling
        data={{ models: [], views: [] } as any}
        onOpenModelDrawer={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(capturedModelTreeProps?.schemaChangeEnabled).toBe(true);
  });
});
