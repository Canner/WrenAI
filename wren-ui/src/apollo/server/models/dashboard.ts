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

export interface SetDashboardCacheData {
  cacheEnabled: boolean;
  schedule: {
    frequency: ScheduleFrequencyEnum;
    timezone: string;
    day: CacheScheduleDayEnum;
    hour: number;
    minute: number;
    cron: string;
  };
}
