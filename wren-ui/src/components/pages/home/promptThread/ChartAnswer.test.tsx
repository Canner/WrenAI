import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartAnswer from './ChartAnswer';

const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockCreateDashboardItem = jest.fn();
const mockUsePromptThreadStore = jest.fn();
const mockEnsureLoaded = jest.fn();
let capturedChartProps: any = null;

let capturedModalProps: any = null;

jest.mock('@apollo/client', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: (...args: any[]) => mockUseMutation(...args),
}));

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
    Modal: (props: any) => {
      capturedModalProps = props;
      return React.createElement('section', null, props.title, props.children);
    },
    Select: ({ options }: any) =>
      React.createElement(
        'select',
        null,
        (options || []).map((option: any) =>
          React.createElement(
            'option',
            { key: option.value, value: option.value },
            option.label,
          ),
        ),
      ),
    message: {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
    },
  };
});

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
  default: () => mockUsePromptThreadStore(),
}));

jest.mock('@/apollo/client/graphql/dashboard', () => ({
  CREATE_DASHBOARD_ITEM: 'CREATE_DASHBOARD_ITEM',
  DASHBOARDS: 'DASHBOARDS',
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
    capturedModalProps = null;
    capturedChartProps = null;
    mockEnsureLoaded.mockResolvedValue({ previewData: { data: [], columns: [] } });
    mockUsePromptThreadStore.mockReturnValue({
      onGenerateChartAnswer: jest.fn(),
      onAdjustChartAnswer: jest.fn(),
    });
    mockUseQuery.mockReturnValue({
      data: {
        dashboards: [
          { id: 11, name: '经营总览' },
          { id: 12, name: '销售看板' },
        ],
      },
      loading: false,
    });
    mockUseMutation.mockReturnValue([
      mockCreateDashboardItem,
      { loading: false },
    ]);
  });

  it('submits createDashboardItem with selected dashboard id when pinning a chart', async () => {
    const useStateSpy = setStateOverrides({
      // 5th state: isPinModalOpen
      5: true,
      // 6th state: pinTargetDashboardId
      6: 11,
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

    await capturedModalProps.onOk();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith({
      variables: {
        data: {
          itemType: 'LINE',
          responseId: 91,
          dashboardId: 11,
        },
      },
    });

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
});
