// eslint-disable-next-line @typescript-eslint/ban-ts-comment
/* @ts-nocheck */
// This file just remain for future scope.
import { v4 as uuidv4 } from 'uuid';
import { METRIC_TYPE, NODE_TYPE } from '@/utils/enum';
import { Metric, MetricColumn } from '@/utils/data/type';

export class MetricData {
  public readonly nodeType: NODE_TYPE = NODE_TYPE.METRIC;

  public readonly id: string;
  public readonly displayName: string;
  public readonly referenceName: string;
  public readonly baseObject: string;
  public readonly cached: boolean;
  public readonly refreshTime: string;
  public readonly properties: Metric['properties'];

  public readonly columns: MetricColumnData[];
  public readonly dimensions: MetricColumnData[];
  public readonly measures: MetricColumnData[];
  public readonly timeGrains: MetricColumnData[];
  public readonly windows: MetricColumnData[];

  constructor(metric: Metric, isCumulative: boolean = false) {
    this.id = uuidv4();
    this.displayName = metric.name;
    this.referenceName = metric.name;

    this.baseObject = metric.baseObject;
    this.cached = metric.cached || false;
    this.refreshTime = metric.refreshTime || null;
    this.properties = metric.properties;

    this.columns = Object.entries({
      [METRIC_TYPE.DIMENSION]: metric.dimension,
      [METRIC_TYPE.MEASURE]: metric.measure,
      [METRIC_TYPE.TIME_GRAIN]: metric.timeGrain,
      [METRIC_TYPE.WINDOW]: metric.window,
    }).reduce((result, [metricType, columns]) => {
      // cumulative metrics measure & window not array type
      const isObject = typeof columns === 'object' && !Array.isArray(columns);
      return [
        ...result,
        ...(isObject ? [columns] : columns || []).map(
          (column) =>
            new MetricColumnData(
              column as MetricColumn,
              metricType as METRIC_TYPE
            )
        ),
      ];
    }, []);

    this.measures = this.columns.filter(
      (column) => column.metricType === METRIC_TYPE.MEASURE
    );
    this.timeGrains = this.columns.filter(
      (column) => column.metricType === METRIC_TYPE.TIME_GRAIN
    );
    this.dimensions = !isCumulative
      ? this.columns.filter(
          (column) => column.metricType === METRIC_TYPE.DIMENSION
        )
      : undefined;
    this.windows = isCumulative
      ? this.columns.filter(
          (column) => column.metricType === METRIC_TYPE.WINDOW
        )
      : undefined;
  }
}

export class MetricColumnData {
  public readonly id: string;
  public readonly displayName: string;
  public readonly type: string;
  public readonly metricType: METRIC_TYPE;
  public readonly operator?: string;
  public readonly refColumn?: string;
  public readonly dateParts?: string[];
  public readonly timeUnit?: string;
  public readonly start?: string;
  public readonly end?: string;
  public readonly isCalculated?: boolean;
  public readonly properties: MetricColumn['properties'];
  // TODO: construct this property
  public readonly modelFields: string[] = [];

  constructor(column: MetricColumn, metricType: METRIC_TYPE) {
    this.id = uuidv4();
    this.displayName = column.name;
    this.type = column?.type || '';
    this.metricType = metricType;
    this.operator = column?.operator;
    this.refColumn = column?.refColumn;
    this.dateParts = column?.dateParts;
    this.timeUnit = column?.timeUnit;
    this.start = column?.start;
    this.end = column?.end;
    this.isCalculated = column?.isCalculated;
    this.properties = column?.properties;
  }
}
