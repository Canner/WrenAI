import { DashboardItem } from '../repositories';

export interface PreviewItemResponse {
  data: Record<string, any>[];
  cacheHit: boolean;
  cacheCreatedAt: string | null;
  cacheOverrideAt: string | null;
  override: boolean;
}

export enum ScheduleFrequencyEnum {
  Weekly = 'Weekly',
  Daily = 'Daily',
  Custom = 'Custom',
  Never = 'Never',
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
  schedule: DashboardSchedule;
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
