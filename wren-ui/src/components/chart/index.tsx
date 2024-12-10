import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { TopLevelSpec, compile } from 'vega-lite';
import embed, { EmbedOptions } from 'vega-embed';
import ChartSpecHandler from './handler';

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
  data?: { columns: string[]; data: any[] };
}

export default function Chart(props: VegaLiteProps) {
  const { spec, data, width = 600 } = props;
  const $container = useRef<HTMLDivElement>(null);

  const vegaValues = useMemo(() => {
    if (!data) return;
    const values =
      (spec?.data as any)?.values ||
      data.data.map((value) =>
        data.columns.reduce((acc, column, index) => {
          acc[column] = value[index];
          return acc;
        }, {}),
      );
    return values;
  }, [data]);
  const vegaSpec = useMemo(() => {
    if (!spec || !vegaValues) return;
    const specHandler = new ChartSpecHandler({
      ...spec,
      data: { values: vegaValues },
    });
    console.log(specHandler.getChartSpec());
    return compile(specHandler.getChartSpec(), {
      config: specHandler.config,
    }).spec;
  }, [spec, vegaValues]);

  useEffect(() => {
    if ($container.current) {
      embed($container.current, vegaSpec, embedOptions);
    }
  }, [vegaSpec]);

  return (
    <div className={clsx('adm-chart py-4')} style={{ width }}>
      <div style={{ width }} ref={$container} />
    </div>
  );
}
