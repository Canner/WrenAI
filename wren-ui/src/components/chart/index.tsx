import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { isEmpty } from 'lodash';
import { Alert, Button, Tooltip } from 'antd';
import { TopLevelSpec, compile } from 'vega-lite';
import embed, { EmbedOptions, Result } from 'vega-embed';
import ChartSpecHandler from './handler';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';

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
  width?: number | string;
  spec?: TopLevelSpec;
  values?: Record<string, any>[];
  onReload?: () => void;
  onEdit?: () => void;
}

export default function Chart(props: VegaLiteProps) {
  const { spec, values, width = 600, onReload, onEdit } = props;
  const [isShowTopCategories, setIsShowTopCategories] = useState(false);
  const $view = useRef<Result>(null);
  const $container = useRef<HTMLDivElement>(null);
  const vegaSpec = useMemo(() => {
    if (!spec || !values) return;
    const specHandler = new ChartSpecHandler(
      {
        ...spec,
        data: { values },
      },
      { isShowTopCategories },
    );
    const chartSpec = specHandler.getChartSpec();
    const isDataEmpty = isEmpty((chartSpec?.data as any)?.values);
    if (isDataEmpty) return null;
    return compile(chartSpec, {
      config: specHandler.config,
    }).spec;
  }, [spec, values, isShowTopCategories]);

  // initial vega view
  useEffect(() => {
    if ($container.current && vegaSpec) {
      embed($container.current, vegaSpec, embedOptions).then((view) => {
        $view.current = view;
      });
    }
    return () => {
      if ($view.current) $view.current.finalize();
    };
  }, [vegaSpec]);

  const onShowTopCategories = () => {
    setIsShowTopCategories(!isShowTopCategories);
  };

  if (vegaSpec === null) {
    return (
      <Alert
        className="mt-6 mb-4 mx-4"
        message={
          <div className="d-flex align-center justify-space-between">
            <div>
              Too many categories, please try to reduce the number of
              categories.
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

  const isAdditionalShow = !!onReload || !!onEdit;

  return (
    <div className={clsx('adm-chart')} style={{ width }}>
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
        </div>
      )}
      <div style={{ width }} ref={$container} />
    </div>
  );
}
