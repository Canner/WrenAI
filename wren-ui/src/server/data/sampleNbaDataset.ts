import { RelationType } from '../types';
import { SampleDatasetName } from './type';
import type { SampleDataset } from './sampleTypes';
import { nbaSampleDatasetTablesPart1 } from './sampleNbaTablesPart1';
import { nbaSampleDatasetTablesPart2 } from './sampleNbaTablesPart2';

export const nbaSampleDataset: SampleDataset = {
  name: SampleDatasetName.NBA,
  tables: [...nbaSampleDatasetTablesPart1, ...nbaSampleDatasetTablesPart2],
  questions: [
    {
      question:
        'How many three-pointers were made by each player in each game?',
      label: 'Aggregation',
    },
    {
      question:
        'What is the differences in turnover rates between teams with high and low average scores?',
      label: 'Comparison',
    },
    {
      question:
        'Which teams had the highest average points scored per game throughout the season?',
      label: 'Ranking',
    },
  ],
  relations: [
    {
      fromModelName: 'game',
      fromColumnName: 'Id',
      toModelName: 'line_score',
      toColumnName: 'GameId',
      type: RelationType.ONE_TO_MANY,
    },
    {
      fromModelName: 'line_score',
      fromColumnName: 'GameId',
      toModelName: 'player_games',
      toColumnName: 'GameID',
      type: RelationType.ONE_TO_MANY,
    },
    {
      fromModelName: 'player',
      fromColumnName: 'TeamId',
      toModelName: 'team',
      toColumnName: 'Id',
      type: RelationType.ONE_TO_ONE,
    },
    {
      fromModelName: 'team',
      fromColumnName: 'Id',
      toModelName: 'game',
      toColumnName: 'TeamIdHome',
      type: RelationType.ONE_TO_MANY,
    },
  ],
};
