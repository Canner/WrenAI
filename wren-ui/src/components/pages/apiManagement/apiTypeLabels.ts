import { ApiType } from '@/types/api';

export const API_HISTORY_FILTER_TYPES = Object.values(ApiType) as ApiType[];

export const formatApiTypeLabel = (apiType?: ApiType | string | null) => {
  if (!apiType) {
    return '-';
  }

  return apiType.toLowerCase();
};
