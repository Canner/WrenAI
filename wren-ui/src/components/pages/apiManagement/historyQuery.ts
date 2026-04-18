import moment from 'moment';
import { ApiType } from '@/types/apiHistory';
import { ApiHistoryDateRange } from './timeRange';

const PAGE_QUERY_KEY = 'page';
const API_TYPE_QUERY_KEY = 'apiType';
const STATUS_CODE_QUERY_KEY = 'statusCode';
const THREAD_ID_QUERY_KEY = 'threadId';
const START_DATE_QUERY_KEY = 'startDate';
const END_DATE_QUERY_KEY = 'endDate';

const MANAGED_QUERY_KEYS = new Set([
  PAGE_QUERY_KEY,
  API_TYPE_QUERY_KEY,
  STATUS_CODE_QUERY_KEY,
  THREAD_ID_QUERY_KEY,
  START_DATE_QUERY_KEY,
  END_DATE_QUERY_KEY,
]);

export interface ApiHistoryTableFilters {
  apiType?: ApiType[];
  statusCode?: number[];
  threadId?: string[];
}

export interface ApiHistoryQueryState {
  currentPage: number;
  filters: ApiHistoryTableFilters;
  dateRange: ApiHistoryDateRange;
}

const readQueryValue = (
  value: string | string[] | number | boolean | null | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return readQueryValue(value[0]);
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = `${value}`.trim();
  return normalizedValue ? normalizedValue : undefined;
};

const readPositiveInteger = (
  value: string | string[] | number | boolean | null | undefined,
): number | undefined => {
  const normalizedValue = readQueryValue(value);
  if (!normalizedValue) {
    return undefined;
  }

  const parsed = Number.parseInt(normalizedValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const readApiTypeFilter = (
  value: string | string[] | number | boolean | null | undefined,
): ApiType[] | undefined => {
  const normalizedValue = readQueryValue(value);
  if (!normalizedValue) {
    return undefined;
  }

  return Object.values(ApiType).includes(normalizedValue as ApiType)
    ? [normalizedValue as ApiType]
    : undefined;
};

const readThreadIdFilter = (
  value: string | string[] | number | boolean | null | undefined,
): string[] | undefined => {
  const normalizedValue = readQueryValue(value);
  return normalizedValue ? [normalizedValue] : undefined;
};

const readStatusCodeFilter = (
  value: string | string[] | number | boolean | null | undefined,
): number[] | undefined => {
  const parsed = readPositiveInteger(value);
  return parsed ? [parsed] : undefined;
};

const readDateBoundary = (
  value: string | string[] | number | boolean | null | undefined,
) => {
  const normalizedValue = readQueryValue(value);
  if (!normalizedValue) {
    return null;
  }

  const parsed = moment(normalizedValue, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed : null;
};

export const readApiHistoryQueryState = (
  query?: Record<string, any> | null,
): ApiHistoryQueryState => {
  const currentPage = readPositiveInteger(query?.[PAGE_QUERY_KEY]) || 1;
  const startDate = readDateBoundary(query?.[START_DATE_QUERY_KEY]);
  const endDate = readDateBoundary(query?.[END_DATE_QUERY_KEY]);

  return {
    currentPage,
    filters: {
      apiType: readApiTypeFilter(query?.[API_TYPE_QUERY_KEY]),
      statusCode: readStatusCodeFilter(query?.[STATUS_CODE_QUERY_KEY]),
      threadId: readThreadIdFilter(query?.[THREAD_ID_QUERY_KEY]),
    },
    dateRange: startDate && endDate ? [startDate, endDate] : null,
  };
};

export const normalizeApiHistoryTableFilters = (
  filters?: Record<string, any> | null,
): ApiHistoryTableFilters => ({
  apiType: readApiTypeFilter(filters?.apiType),
  statusCode: readStatusCodeFilter(filters?.statusCode),
  threadId: readThreadIdFilter(filters?.threadId),
});

export const buildApiHistoryQueryParams = ({
  currentPage,
  filters,
  dateRange,
}: ApiHistoryQueryState): Record<string, string> => {
  const params: Record<string, string> = {};

  if (currentPage > 1) {
    params[PAGE_QUERY_KEY] = `${currentPage}`;
  }

  if (filters.apiType?.[0]) {
    params[API_TYPE_QUERY_KEY] = filters.apiType[0];
  }

  if (filters.statusCode?.[0]) {
    params[STATUS_CODE_QUERY_KEY] = `${filters.statusCode[0]}`;
  }

  if (filters.threadId?.[0]) {
    params[THREAD_ID_QUERY_KEY] = filters.threadId[0];
  }

  if (dateRange?.[0] && dateRange?.[1]) {
    params[START_DATE_QUERY_KEY] = dateRange[0].format('YYYY-MM-DD');
    params[END_DATE_QUERY_KEY] = dateRange[1].format('YYYY-MM-DD');
  }

  return params;
};

export const omitApiHistoryManagedQuery = (
  source?: Record<string, any> | null,
): Record<string, string> =>
  Object.entries(source || {}).reduce<Record<string, string>>(
    (result, [key, value]) => {
      if (MANAGED_QUERY_KEYS.has(key)) {
        return result;
      }

      const normalizedValue = readQueryValue(value);
      if (normalizedValue) {
        result[key] = normalizedValue;
      }

      return result;
    },
    {},
  );
