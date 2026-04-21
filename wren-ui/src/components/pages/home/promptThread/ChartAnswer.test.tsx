import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartAnswer from './ChartAnswer';

const mockCreateDashboardItem = jest.fn();
const mockUsePromptThreadActionsStore = jest.fn();
const mockEnsureLoaded = jest.fn();
const mockLoadDashboardListPayload = jest.fn();
const mockCreateDashboard = jest.fn();
const mockPushWorkspace = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();
const mockMessageWarning = jest.fn();
let capturedChartProps: any = null;

let capturedPinModalProps: any = null;

jest.mock('next/dynamic', () => () => {
  const React = jest.requireActual('react');
  return (props: any) => {
    capturedChartProps = props;
    return React.createElement('div', null, props.onPin ? 'Chart' : 'NoChart');
  };
});

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const FormComponent = ({ children }: any) =>
    React.createElement('form', null, children);
  (FormComponent as any).useForm = () => [
    {
      setFieldsValue: jest.fn(),
      getFieldsValue: () => ({ chartType: 'LINE' }),
      resetFields: jest.fn(),
    },
  ];
  (FormComponent as any).useWatch = () => 'LINE';

  return {
    Alert: ({ message, description }: any) =>
      React.createElement('div', null, message, description),
    Form: FormComponent,
    Button: ({ children, onClick }: any) =>
      React.createElement('button', { onClick }, children),
    Skeleton: ({ children }: any) => React.createElement('div', null, children),
    Input: Object.assign(
      ({ allowClear: _allowClear, ...props }: any) =>
        React.createElement('input', props),
      {
        Search: ({ allowClear: _allowClear, ...props }: any) =>
          React.createElement('input', props),
      },
    ),
    Modal: () => React.createElement('section'),
    message: {
      success: (...args: any[]) => mockMessageSuccess(...args),
      error: (...args: any[]) => mockMessageError(...args),
      warning: (...args: any[]) => mockMessageWarning(...args),
    },
  };
});

jest.mock('./ChartAnswerPinModal', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedPinModalProps = props;
    const React = jest.requireActual('react');
    return React.createElement(
      'section',
      null,
      props.open ? 'PinModalOpen' : 'PinModalClosed',
    );
  },
}));

jest.mock('./ChartAnswerPinPopover', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('section', null, 'PinPopover');
  },
}));

jest.mock('@/components/chart/properties/BasicProperties', () => () => null);
jest.mock('@/components/chart/properties/DonutProperties', () => () => null);
jest.mock('@/components/chart/properties/LineProperties', () => () => null);
jest.mock(
  '@/components/chart/properties/StackedBarProperties',
  () => () => null,
);
jest.mock(
  '@/components/chart/properties/GroupedBarProperties',
  () => () => null,
);

jest.mock('@/components/chart/meta', () => ({
  getChartSpecFieldTitleMap: () => ({}),
  getChartSpecOptionValues: () => ({ chartType: 'LINE' }),
}));

jest.mock('@/hooks/useResponsePreviewData', () => ({
  __esModule: true,
  default: () => ({
    data: { previewData: { data: [], columns: [] } },
    loading: false,
    error: undefined,
    called: true,
    ensureLoaded: mockEnsureLoaded,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/components/pages/home/promptThread/store', () => ({
  __esModule: true,
  usePromptThreadActionsStore: () => mockUsePromptThreadActionsStore(),
}));

jest.mock('@/utils/dashboardRest', () => ({
  createDashboard: (...args: any[]) => mockCreateDashboard(...args),
  loadDashboardListPayload: (...args: any[]) =>
    mockLoadDashboardListPayload(...args),
  resolveDashboardDisplayName: (name?: string | null) =>
    !name || name === 'Dashboard' ? '默认看板' : name,
}));

jest.mock('@/utils/homeRest', () => ({
  createDashboardItem: (...args: any[]) => mockCreateDashboardItem(...args),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    selector: { workspaceId: 'ws-1' },
    pushWorkspace: mockPushWorkspace,
  }),
}));

const setStateOverrides = (overrides: Partial<Record<number, any>>) => {
  let callIndex = 0;
  const spy = jest.spyOn(React, 'useState' as any) as jest.SpyInstance;
  return spy.mockImplementation(((initial: any) => {
    callIndex += 1;
    if (Object.prototype.hasOwnProperty.call(overrides, callIndex)) {
      return [overrides[callIndex], jest.fn()];
    }
    return [typeof initial === 'function' ? initial() : initial, jest.fn()];
  }) as any);
};

describe('ChartAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedPinModalProps = null;
    capturedChartProps = null;
    mockEnsureLoaded.mockResolvedValue({
      previewData: { data: [], columns: [] },
    });
    mockUsePromptThreadActionsStore.mockReturnValue({
      onGenerateChartAnswer: jest.fn(),
      onAdjustChartAnswer: jest.fn(),
    });
    mockLoadDashboardListPayload.mockResolvedValue([
      { id: 11, name: '经营总览' },
      { id: 12, name: '销售看板' },
    ]);
    mockCreateDashboard.mockResolvedValue({
      id: 13,
      name: '本周经营复盘',
      isDefault: false,
      cacheEnabled: false,
      scheduleFrequency: null,
    });
    mockCreateDashboardItem.mockResolvedValue({
      id: 901,
      dashboardId: 11,
    });
  });

  it('pins directly when there is only one dashboard', async () => {
    const useStateSpy = setStateOverrides({
      // 8th state: dashboardOptions
      8: [{ id: 11, name: '经营总览' }],
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 91,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      {
        itemType: 'LINE',
        responseId: 91,
        dashboardId: 11,
      },
    );

    useStateSpy.mockRestore();
  });

  it('submits createDashboardItem with selected dashboard id from the popover when multiple dashboards exist', async () => {
    const useStateSpy = setStateOverrides({
      // 5th state: isPinPopoverOpen
      5: true,
      // 8th state: dashboardOptions
      8: [
        { id: 11, name: '经营总览' },
        { id: 12, name: '销售看板' },
      ],
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 91,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    const popoverElement = capturedChartProps.pinPopoverContent;
    await popoverElement.props.onSelectDashboard(12, '销售看板');

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      {
        itemType: 'LINE',
        responseId: 91,
        dashboardId: 12,
      },
    );

    useStateSpy.mockRestore();
  });

  it('passes canonical renderer hints through to the chart component', () => {
    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 92,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            renderHints: {
              preferredRenderer: 'canvas',
            },
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    expect(capturedChartProps?.preferredRenderer).toBe('canvas');
  });

  it('shows normalized default dashboard name in pin success message', async () => {
    const useStateSpy = setStateOverrides({
      // 8th state: dashboardOptions
      8: [{ id: 11, name: 'Dashboard' }],
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 93,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockMessageSuccess).toHaveBeenCalledWith('已固定到看板「默认看板」');

    useStateSpy.mockRestore();
  });

  it('creates a dashboard before pinning when using create-and-pin action', async () => {
    const useStateSpy = setStateOverrides({
      6: true,
      8: [{ id: 11, name: '经营总览' }],
    });
    mockCreateDashboardItem.mockResolvedValueOnce({
      id: 902,
      dashboardId: 13,
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 94,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedPinModalProps.onSubmit('本周经营复盘');

    expect(mockCreateDashboard).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      { name: '本周经营复盘' },
    );
    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      {
        itemType: 'LINE',
        responseId: 94,
        dashboardId: 13,
      },
    );

    useStateSpy.mockRestore();
  });
});
