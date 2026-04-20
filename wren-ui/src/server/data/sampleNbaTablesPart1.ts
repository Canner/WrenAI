import type { SampleDatasetTable } from './sampleTypes';

export const nbaSampleDatasetTablesPart1: SampleDatasetTable[] = [
  {
    tableName: 'game',
    primaryKey: 'Id',
    filePath: 'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/game.csv',
    columns: [
      {
        name: 'Id',
      },
      {
        name: 'SeasonId',
      },
      {
        name: 'TeamIdHome',
      },
      {
        name: 'WlHome',
      },
      {
        name: 'Min',
      },
      {
        name: 'FgmHome',
        properties: {
          description: 'number of field goals made by the home team.',
        },
      },
      {
        name: 'FgaHome',
        properties: {
          description: 'number of field goals attempted by the home team.',
        },
      },
      {
        name: 'threepHome',
        properties: {
          description:
            'number of three point field goals made by the home team.',
        },
      },
      {
        name: 'threepaHome',
        properties: {
          description:
            'number of three point field goals attempted by the home team.',
        },
      },
      {
        name: 'FtmHome',
        properties: {
          description: 'number of free throws made by the home team.',
        },
      },
      {
        name: 'FtaHome',
        properties: {
          description: 'number of free throws attempted by the home team.',
        },
      },
      {
        name: 'OrebHome',
        properties: {
          description: 'number of offensive rebounds by the home team.',
        },
      },
      {
        name: 'DrebHome',
        properties: {
          description: 'number of defensive rebounds by the home team.',
        },
      },
      {
        name: 'RebHome',
        properties: { description: 'number of rebounds by the home team.' },
      },
      {
        name: 'AstHome',
        properties: { description: 'number of assists by the home team.' },
      },
      {
        name: 'StlHome',
        properties: { description: 'number of steels by the home team.' },
      },
      {
        name: 'BlkHome',
        properties: { description: 'number of blocks by the home team.' },
      },
      {
        name: 'TovHome',
        properties: {
          description: 'number of turnovers by the home team.',
        },
      },
      {
        name: 'PfHome',
        properties: {
          description: 'number of personal fouls by the home team.',
        },
      },
      {
        name: 'PtsHome',
        properties: { description: 'Total score of the home team.' },
      },
      {
        name: 'PlusMimusHome',
      },
      {
        name: 'TeamIdAway',
      },
      {
        name: 'WlAway',
      },
      {
        name: 'FgmAway',
        properties: {
          description: 'number of field goals made by the away team.',
        },
      },
      {
        name: 'FgaAway',
        properties: {
          description: 'number of field goals attempted by the away team.',
        },
      },
      {
        name: 'threepAway',
        properties: {
          description:
            'number of three point field goals made by the away team.',
        },
      },
      {
        name: 'threepaAway',
        properties: {
          description:
            'number of three point field goals attempted by the away team.',
        },
      },
      {
        name: 'FtmAway',
        properties: {
          description: 'number of free throws made by the away team.',
        },
      },
      {
        name: 'FtaAway',
        properties: {
          description: 'number of free throws attempted by the away team.',
        },
      },
      {
        name: 'OrebAway',
        properties: {
          description: 'number of offensive rebounds by the away team.',
        },
      },
      {
        name: 'DrebAway',
        properties: {
          description: 'number of defensive rebounds by the away team.',
        },
      },
      {
        name: 'RebAway',
        properties: { description: 'number of rebounds by the away team.' },
      },
      {
        name: 'AstAway',
        properties: { description: 'number of assists by the away team.' },
      },
      {
        name: 'StlAway',
        properties: { description: 'number of steels by the away team.' },
      },
      {
        name: 'BlkAway',
        properties: { description: 'number of blocks by the away team.' },
      },
      {
        name: 'TovAway',
        properties: {
          description: 'number of turnovers by the away team.',
        },
      },
      {
        name: 'PfAway',
        properties: {
          description: 'number of personal fouls by the away team.',
        },
      },
      {
        name: 'PtsAway',
        properties: { description: 'Total score of the away team.' },
      },
      {
        name: 'PlusMimusAway',
      },
      {
        name: 'seasonType',
      },
    ],
    schema: [
      { columnName: 'SeasonId', dataType: 'BIGINT' },
      { columnName: 'TeamIdHome', dataType: 'BIGINT' },
      { columnName: 'Id', dataType: 'BIGINT' },
      { columnName: 'GameDate', dataType: 'DATE' },
      { columnName: 'WlHome', dataType: 'VARCHAR' },
      { columnName: 'Min', dataType: 'BIGINT' },
      { columnName: 'FgmHome', dataType: 'BIGINT' },
      { columnName: 'FgaHome', dataType: 'BIGINT' },
      { columnName: 'FgPct_home', dataType: 'DOUBLE' },
      { columnName: 'threepHome', dataType: 'BIGINT' },
      { columnName: 'threepaHome', dataType: 'BIGINT' },
      { columnName: 'fg3_pct_home', dataType: 'DOUBLE' },
      { columnName: 'FtmHome', dataType: 'BIGINT' },
      { columnName: 'FtaHome', dataType: 'BIGINT' },
      { columnName: 'ft_pct_home', dataType: 'DOUBLE' },
      { columnName: 'OrebHome', dataType: 'BIGINT' },
      { columnName: 'DrebHome', dataType: 'BIGINT' },
      { columnName: 'RebHome', dataType: 'BIGINT' },
      { columnName: 'AstHome', dataType: 'BIGINT' },
      { columnName: 'StlHome', dataType: 'BIGINT' },
      { columnName: 'BlkHome', dataType: 'BIGINT' },
      { columnName: 'TovHome', dataType: 'BIGINT' },
      { columnName: 'PfHome', dataType: 'BIGINT' },
      { columnName: 'PtsHome', dataType: 'BIGINT' },
      { columnName: 'PlusMinusHome', dataType: 'BIGINT' },
      { columnName: 'TeamIdAway', dataType: 'BIGINT' },
      { columnName: 'WlAway', dataType: 'VARCHAR' },
      { columnName: 'FgmAway', dataType: 'BIGINT' },
      { columnName: 'FgaAway', dataType: 'BIGINT' },
      { columnName: 'fg_pct_away', dataType: 'DOUBLE' },
      { columnName: 'threepAway', dataType: 'BIGINT' },
      { columnName: 'threepaAway', dataType: 'BIGINT' },
      { columnName: 'Fg3_pct_away', dataType: 'DOUBLE' },
      { columnName: 'FtmAway', dataType: 'BIGINT' },
      { columnName: 'FtaAway', dataType: 'BIGINT' },
      { columnName: 'Ft_pct_away', dataType: 'DOUBLE' },
      { columnName: 'OrebAway', dataType: 'BIGINT' },
      { columnName: 'DrebAway', dataType: 'BIGINT' },
      { columnName: 'RebAway', dataType: 'BIGINT' },
      { columnName: 'AstAway', dataType: 'BIGINT' },
      { columnName: 'StlAway', dataType: 'BIGINT' },
      { columnName: 'BlkAway', dataType: 'BIGINT' },
      { columnName: 'TovAway', dataType: 'BIGINT' },
      { columnName: 'PfAway', dataType: 'BIGINT' },
      { columnName: 'PtsAway', dataType: 'BIGINT' },
      { columnName: 'PlusMinusAway', dataType: 'BIGINT' },
      { columnName: 'SeasonType', dataType: 'VARCHAR' },
    ],
    properties: {
      description:
        'This table describes the game statistics for both the home and away teams in each NBA game. Turnover percentage is the number of possessions that end in a turnover. The formula for turnover percentage (TOV%) is "TOV% = (Tov ÷ (FGA + (0.44 x FTA) + Tov)) x 100%".',
    },
  },
  {
    tableName: 'line_score',
    primaryKey: 'GameId',
    filePath:
      'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/line_score.csv',
    columns: [
      {
        name: 'GameId',
      },
      {
        name: 'GameDate',
      },
      {
        name: 'GameSequence',
      },
      {
        name: 'TeamIdHome',
      },
      {
        name: 'TeamWinsLossesHome',
      },
      {
        name: 'PtsQtr1Home',
        properties: {
          description: 'The score of the home team in the first quarter.',
        },
      },
      {
        name: 'PtsQtr2Home',
        properties: {
          description: 'The score of the home team in the second quarter.',
        },
      },
      {
        name: 'PtsQtr3Home',
        properties: {
          description: 'The score of the home team in the third quarter.',
        },
      },
      {
        name: 'PtsQtr4Home',
        properties: {
          description: 'The score of the home team in the fourth quarter.',
        },
      },
      {
        name: 'PtsOt1Home',
        properties: {
          description:
            'The score of the home team in the overtime. The value of 0 indicates that the game did not go into overtime.',
        },
      },
      {
        name: 'PtsHome',
        properties: { description: 'Total score of the home team.' },
      },
      {
        name: 'TeamIdAway',
      },
      {
        name: 'TeamWinsLossesAway',
      },
      {
        name: 'PtsQtr1Away',
        properties: {
          description: 'The score of the away team in the first quarter.',
        },
      },
      {
        name: 'PtsQtr2Away',
        properties: {
          description: 'The score of the away team in the second quarter.',
        },
      },
      {
        name: 'PtsQtr3Away',
        properties: {
          description: 'The score of the away team in the third quarter.',
        },
      },
      {
        name: 'PtsQtr4Away',
        properties: {
          description: 'The score of the away team in the fourth quarter.',
        },
      },
      {
        name: 'PtsOt1Away',
        properties: {
          description:
            'The score of the away team in the overtime. The value of 0 indicates that the game did not go into overtime.',
        },
      },
      {
        name: 'PtsAway',
        properties: { description: 'Total score of the away team.' },
      },
    ],
    schema: [
      { columnName: 'GameDate', dataType: 'DATE' },
      { columnName: 'GameSequence', dataType: 'BIGINT' },
      { columnName: 'GameId', dataType: 'BIGINT' },
      { columnName: 'TeamIdHome', dataType: 'BIGINT' },
      { columnName: 'TeamWinsLossesHome', dataType: 'VARCHAR' },
      { columnName: 'PtsQtr1Home', dataType: 'BIGINT' },
      { columnName: 'PtsQtr2Home', dataType: 'BIGINT' },
      { columnName: 'PtsQtr3Home', dataType: 'BIGINT' },
      { columnName: 'PtsQtr4Home', dataType: 'BIGINT' },
      { columnName: 'PtsOt1Home', dataType: 'BIGINT' },
      { columnName: 'PtsHome', dataType: 'BIGINT' },
      { columnName: 'TeamIdAway', dataType: 'BIGINT' },
      { columnName: 'TeamWinsLossesAway', dataType: 'VARCHAR' },
      { columnName: 'PtsQtr1Away', dataType: 'BIGINT' },
      { columnName: 'PtsQtr2Away', dataType: 'BIGINT' },
      { columnName: 'PtsQtr3Away', dataType: 'BIGINT' },
      { columnName: 'PtsQtr4Away', dataType: 'BIGINT' },
      { columnName: 'PtsOt1Away', dataType: 'BIGINT' },
      { columnName: 'PtsAway', dataType: 'BIGINT' },
    ],
    properties: {
      description:
        'This table describes the scores and total score for each quarter or overtime of an NBA game, detailing the scores for both the home team and the away team.',
    },
  },
];
