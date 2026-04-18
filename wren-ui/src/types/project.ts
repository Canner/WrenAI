export type ModelSyncResponse = {
  status: SyncStatus;
};

export enum OnboardingStatus {
  CONNECTION_SAVED = 'CONNECTION_SAVED',
  NOT_STARTED = 'NOT_STARTED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

export type OnboardingStatusResponse = {
  status?: OnboardingStatus | null;
};

export enum ProjectLanguage {
  AR = 'AR',
  AZ_AZ = 'AZ_AZ',
  DE = 'DE',
  EN = 'EN',
  ES = 'ES',
  FA_IR = 'FA_IR',
  FR = 'FR',
  IT = 'IT',
  JA = 'JA',
  KO = 'KO',
  NL = 'NL',
  PT = 'PT',
  RU = 'RU',
  TR = 'TR',
  ZH_CN = 'ZH_CN',
  ZH_TW = 'ZH_TW',
}

export enum SyncStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}
