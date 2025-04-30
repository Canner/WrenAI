import { DashboardItem } from '@server/repositories';

export interface PreviewItemResponse {
  data: Record<string, any>[];
  cacheHit: boolean;
  cacheCreatedAt: string | null;
  cacheOverrodeAt: string | null;
  override: boolean;
}

export enum ScheduleFrequencyEnum {
  WEEKLY = 'WEEKLY',
  DAILY = 'DAILY',
  CUSTOM = 'CUSTOM',
  NEVER = 'NEVER',
}

export enum CacheScheduleDayEnum {
  SUN = 'SUN',
  MON = 'MON',
  TUE = 'TUE',
  WED = 'WED',
  THU = 'THU',
  FRI = 'FRI',
  SAT = 'SAT',
}

export interface DashboardSchedule {
  frequency: ScheduleFrequencyEnum;
  timezone: string;
  day: CacheScheduleDayEnum;
  hour: number;
  minute: number;
  cron: string;
}

export interface SetDashboardCacheData {
  cacheEnabled: boolean;
  schedule: DashboardSchedule | null;
}

export interface DetailedDashboard {
  id: number;
  projectId: number;
  name: string;
  cacheEnabled: boolean;
  scheduleFrequency: ScheduleFrequencyEnum | null;
  timezone: string | null; // e.g. 'America/New_York', 'Asia/Taipei'
  scheduleCron: string | null; // cron expression string
  nextScheduledAt: string | null; // Next scheduled run timestamp
  items: DashboardItem[];
}

export const DAYS = [
  CacheScheduleDayEnum.SUN,
  CacheScheduleDayEnum.MON,
  CacheScheduleDayEnum.TUE,
  CacheScheduleDayEnum.WED,
  CacheScheduleDayEnum.THU,
  CacheScheduleDayEnum.FRI,
  CacheScheduleDayEnum.SAT,
];
