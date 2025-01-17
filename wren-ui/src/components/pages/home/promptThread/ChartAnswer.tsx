import clsx from 'clsx';
import dynamic from 'next/dynamic';
import styled from 'styled-components';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Form, Button, Skeleton, Modal, message } from 'antd';
import { attachLoading } from '@/utils/helper';
import { ReloadOutlined } from '@ant-design/icons';
import BasicProperties from '@/components/chart/properties/BasicProperties';
import DonutProperties from '@/components/chart/properties/DonutProperties';
import LineProperties from '@/components/chart/properties/LineProperties';
import StackedBarProperties from '@/components/chart/properties/StackedBarProperties';
import GroupedBarProperties from '@/components/chart/properties/GroupedBarProperties';
import {
  AdjustThreadResponseChartInput,
  ChartTaskStatus,
  ChartType,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';
import { isEmpty, isEqual } from 'lodash';
import {
  getChartSpecFieldTitleMap,
  getChartSpecOptionValues,
} from '@/components/chart/handler';
import { useCreateDashboardItemMutation } from '@/apollo/client/graphql/dashboard.generated';
import { DashboardItemType } from '@/apollo/server/repositories';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

const ChartWrapper = styled.div`
  position: relative;
  padding-top: 0;
  transition: padding-top 0.2s ease-out;
  &.isEditMode {
    padding-top: 72px;
  }
`;

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--gray-3);
  padding: 8px 16px;
  position: absolute;
  top: -72px;
  left: 0;
  right: 0;
  transition: top 0.2s ease-out;
  &.isEditMode {
    top: 0;
  }
`;

interface Props {
  threadResponse: ThreadResponse;
  onRegenerateChartAnswer: (responseId: number) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
}

export const getIsChartFinished = (status: ChartTaskStatus) => {
  return [
    ChartTaskStatus.FINISHED,
    ChartTaskStatus.FAILED,
    ChartTaskStatus.STOPPED,
  ].includes(status);
};

const getDynamicProperties = (chartType: ChartType) => {
  const propertiesMap = {
    [ChartType.GROUPED_BAR]: GroupedBarProperties,
    [ChartType.STACKED_BAR]: StackedBarProperties,
    [ChartType.LINE]: LineProperties,
    [ChartType.MULTI_LINE]: LineProperties,
    [ChartType.PIE]: DonutProperties,
  };
  return propertiesMap[chartType] || BasicProperties;
};

export default function ChartAnswer(props: Props) {
  const { threadResponse, onRegenerateChartAnswer, onAdjustChartAnswer } =
    props;
  const [regenerating, setRegenerating] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newValues, setNewValues] = useState(null);

  const [form] = Form.useForm();
  const chartType = Form.useWatch('chartType', form);
  const { chartDetail } = threadResponse;
  const { error, status, adjustment } = chartDetail || {};

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const [createDashboardItem] = useCreateDashboardItemMutation({
    onError: (error) => console.error(error),
    onCompleted: () => {
      message.success('Successfully pinned chart to dashboard.');
    },
  });

  // initial trigger when render
  useEffect(() => {
    previewData({
      variables: { where: { responseId: threadResponse.id } },
    });
  }, []);

  const chartSpec = useMemo(() => {
    if (
      !chartDetail?.chartSchema ||
      (getIsChartFinished(status) && isEmpty(chartDetail?.chartSchema))
    )
      return null;
    return chartDetail.chartSchema;
  }, [chartDetail]);

  const chartOptionValues = useMemo(() => {
    return getChartSpecOptionValues(chartDetail);
  }, [chartDetail]);

  const chartSpecFieldTitleMap = useMemo(() => {
    return getChartSpecFieldTitleMap(chartSpec?.encoding);
  }, [chartSpec]);

  useEffect(() => {
    form.setFieldsValue(chartOptionValues);
  }, [chartOptionValues]);

  const isAdjusted = useMemo(() => {
    return newValues !== null && !isEqual(chartOptionValues, newValues);
  }, [chartOptionValues, newValues]);

  const dataValues = useMemo(() => {
    const { data, columns } = previewDataResult.data?.previewData || {};
    return (data || []).map((val) => {
      return (columns || []).reduce((acc, col, index) => {
        acc[col.name] = val[index];
        return acc;
      }, {});
    });
  }, [previewDataResult.data]);

  const dataColumns = useMemo(() => {
    const { columns } = previewDataResult.data?.previewData || {};
    return columns || [];
  }, [previewDataResult.data]);

  const loading =
    previewDataResult.loading || !getIsChartFinished(status) || regenerating;

  const DynamicProperties = getDynamicProperties(chartType as ChartType);

  const onFormChange = () => {
    setNewValues(form.getFieldsValue());
  };

  const onRegenerate = () => {
    attachLoading(onRegenerateChartAnswer, setRegenerating)(threadResponse.id);
    onResetState();
  };

  const onResetState = () => {
    setIsEditMode(false);
    setNewValues(null);
    form.resetFields();
  };

  const onReload = () => {
    Modal.confirm({
      title: 'Are you sure you want to regenerate the chart?',
      onOk: onRegenerate,
    });
  };

  const onEdit = () => {
    setIsEditMode(!isEditMode);
  };

  const onPin = () => {
    Modal.confirm({
      title: 'Are you sure you want to pin this chart to the dashboard?',
      okText: 'Save',
      onOk: async () =>
        await createDashboardItem({
          variables: {
            data: {
              // DashboardItemType is compatible with ChartType
              itemType: chartType as unknown as DashboardItemType,
              responseId: threadResponse.id,
            },
          },
        }),
    });
  };

  const onResetAdjustment = () => {
    setNewValues(null);
    form.resetFields();
  };

  const onAdjustChart = async () => {
    attachLoading(onAdjustChartAnswer, setRegenerating)(
      threadResponse.id,
      form.getFieldsValue(),
    );
    onResetState();
  };

  const regenerateBtn = (
    <div className="text-center mt-4">
      <Button icon={<ReloadOutlined />} onClick={onReload}>
        Regenerate
      </Button>
    </div>
  );

  if (error) {
    return (
      <div className="py-6 px-4">
        <Alert
          message={error.shortMessage}
          description={error.message}
          type="error"
          showIcon
        />
        {regenerateBtn}
      </div>
    );
  }

  const chartRegenerateBtn = adjustment ? regenerateBtn : null;

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 py-6 px-4">
        {chartDetail?.description}
        {chartSpec ? (
          <ChartWrapper
            className={clsx(
              'border border-gray-4 rounded mt-4 pb-3 overflow-hidden',
              { isEditMode: isEditMode },
            )}
          >
            <Toolbar className={clsx({ isEditMode: isEditMode })}>
              <Form
                size="small"
                style={{ width: '100%' }}
                form={form}
                initialValues={chartOptionValues}
                onFieldsChange={onFormChange}
              >
                <div className="d-flex justify-content-between align-center">
                  <div className="flex-grow-1">
                    <DynamicProperties
                      columns={dataColumns}
                      titleMap={chartSpecFieldTitleMap}
                    />
                  </div>
                  {isAdjusted && (
                    <div className="d-flex flex-column">
                      <Button className="ml-4 mb-2" onClick={onResetAdjustment}>
                        Reset
                      </Button>
                      <Button
                        className="ml-4"
                        type="primary"
                        onClick={onAdjustChart}
                      >
                        Adjust
                      </Button>
                    </div>
                  )}
                </div>
              </Form>
            </Toolbar>
            <Chart
              width={700}
              spec={chartSpec}
              values={dataValues}
              onEdit={onEdit}
              onReload={onReload}
              onPin={onPin}
            />
          </ChartWrapper>
        ) : (
          chartRegenerateBtn
        )}
      </div>
    </StyledSkeleton>
  );
}
