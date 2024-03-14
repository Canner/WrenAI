export enum JOIN_TYPE {
  MANY_TO_ONE = 'MANY_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  ONE_TO_ONE = 'ONE_TO_ONE',
}

export enum METRIC_TYPE {
  DIMENSION = 'dimension',
  MEASURE = 'measure',
  TIME_GRAIN = 'timeGrain',
  WINDOW = 'window',
}

export enum NODE_TYPE {
  MODEL = 'model',
  METRIC = 'metric',
  VIEW = 'view',
  RELATION = 'relation',
  FIELD = 'field',
  CALCULATED_FIELD = 'calculatedField',
}

export enum CACHED_PERIOD {
  DAY = 'd',
  HOUR = 'h',
  MINUTE = 'm',
  SECOND = 's',
}

export enum GRANULARITY {
  DAY = 'day',
  MONTH = 'month',
  YEAR = 'year',
}

export enum TIME_UNIT {
  YEAR = 'year',
  QUARTER = 'quarter',
  MONTH = 'month',
  WEEK = 'week',
  DAY = 'day',
  HOUR = 'hour',
  MINUTE = 'minute',
  SECOND = 'second',
}

export enum MODEL_STEP {
  ONE = '1',
  TWO = '2',
}

export enum METRIC_STEP {
  ONE = '1',
  TWO = '2',
}

export enum MORE_ACTION {
  EDIT = 'edit',
  DELETE = 'delete',
}
