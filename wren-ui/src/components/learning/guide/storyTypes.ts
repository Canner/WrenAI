import { SampleDatasetName } from '@/types/dataSource';
import { ProjectLanguage } from '@/types/project';

export type StoryPayload = {
  sampleDataset?: SampleDatasetName;
  language?: ProjectLanguage;
};
