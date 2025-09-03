import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { isEmpty } from 'lodash';
import { Alert, Button, Tooltip } from 'antd';
import { TopLevelSpec, compile } from 'vega-lite';
import embed, { EmbedOptions, Result } from 'vega-embed';
import ChartSpecHandler from './handler';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import PushPinOutlined from '@ant-design/icons/PushpinOutlined';
import ErrorCollapse from '@/components/ErrorCollapse';

const embedOptions: EmbedOptions = {
  mode: 'vega-lite',
  renderer: 'svg',
  tooltip: { theme: 'custom' },
  actions: {
    export: true,
    editor: false,
  },
};

interface VegaLiteProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  spec?: TopLevelSpec;
  values?: Record<string, any>[];
  autoFilter?: boolean;
  hideActions?: boolean;
  hideTitle?: boolean;
  hideLegend?: boolean;
  forceUpdate?: number;
  isPinned?: boolean;
  onReload?: () => void;
  onEdit?: () => void;
  onPin?: () => void;
}

export default function Chart(props: VegaLiteProps) {
  const {
    className,
    spec,
    values,
    width = 600,
    height = 320,
    autoFilter,
    hideActions,
    hideTitle,
    hideLegend,
    forceUpdate,
    isPinned,
    onReload,
    onEdit,
    onPin,
  } = props;

  const [donutInner, setDonutInner] = useState(null);
  const [parsedSpec, setParsedSpec] =
    useState<ReturnType<typeof compile>['spec']>(null);
  const [parsedError, setParsedError] = useState<Record<string, any>>(null);
  const [isShowTopCategories, setIsShowTopCategories] = useState(false);
  const $view = useRef<Result>(null);
  const $container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spec || !values) return;
    try {
      const specHandler = new ChartSpecHandler(
        {
          ...spec,
          data: { values },
        },
        {
          donutInner,
          isShowTopCategories: autoFilter || isShowTopCategories,
          isHideLegend: hideLegend,
          isHideTitle: hideTitle,
        },
      );
      const chartSpec = specHandler.getChartSpec();
      const isDataEmpty = isEmpty((chartSpec?.data as any)?.values);
      if (isDataEmpty) {
        setParsedSpec(null);
      } else {
        const compiled = compile(chartSpec, { config: specHandler.config });
        setParsedSpec(compiled.spec);
      }
    } catch (error) {
      console.error(error);
      setParsedError({
        code: 'CLIENT_PARSE_ERROR',
        shortMessage: 'Failed to render chart visualization',
        message: error?.message,
        stacktrace: error?.stack?.split('\n') || [],
      });
    }
    return () => {
      setParsedSpec(null);
      setParsedError(null);
    };
  }, [spec, values, isShowTopCategories, donutInner, forceUpdate]);

  // initial vega view
  useEffect(() => {
    if ($container.current && parsedSpec) {
      embed($container.current, parsedSpec, embedOptions).then((view) => {
        $view.current = view;
      });
    }
    return () => {
      if ($view.current) $view.current.finalize();
    };
  }, [parsedSpec, forceUpdate]);

  useEffect(() => {
    if ($container.current) {
      setDonutInner($container.current.clientHeight * 0.15);
    }
  }, [forceUpdate]);

  const onShowTopCategories = () => {
    setIsShowTopCategories(!isShowTopCategories);
  };

  const getChartContent = () => {
    if (values.length === 0) return <div>No available data</div>;

    if (parsedError) {
      return (
        <div
          className={clsx({ 'mx-4 mt-12': !isPinned })}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Alert
            showIcon
            type="error"
            message={parsedError.shortMessage}
            description={
              <ErrorCollapse message={parsedError.message} defaultActive />
            }
          />
        </div>
      );
    }

    if (parsedSpec === null) {
      return (
        <Alert
          className="mt-12 mb-4 mx-4"
          message={
            <div className="d-flex align-center justify-space-between">
              <div>
                There are too many categories to display effectively. Click
                'Show top 25' to view the top results, or ask a follow-up
                question to focus on a specific group or filter results.
              </div>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={onShowTopCategories}
              >
                Show top 25
              </Button>
            </div>
          }
          type="warning"
        />
      );
    }

    return <div style={{ width, height }} ref={$container} />;
  };

  const isAdditionalShow = !!onReload || !!onEdit || !!onPin;

  return (
    <div
      className={clsx(
        'adm-chart',
        { 'adm-chart--no-actions': hideActions },
        className,
      )}
      style={{ width }}
    >
      {isAdditionalShow && (
        <div className="adm-chart-additional d-flex justify-content-between align-center">
          {!!onReload && (
            <Tooltip title="Regenerate chart">
              <button onClick={onReload}>
                <ReloadOutlined />
              </button>
            </Tooltip>
          )}
          {!!onEdit && (
            <Tooltip title="Edit chart">
              <button onClick={onEdit}>
                <EditOutlined />
              </button>
            </Tooltip>
          )}
          {!!onPin && (
            <Tooltip title="Pin chart to dashboard">
              <button onClick={onPin}>
                <PushPinOutlined />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      {getChartContent()}
    </div>
  );
}
