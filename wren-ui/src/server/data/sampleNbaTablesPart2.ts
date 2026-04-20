import type { SampleDatasetTable } from './sampleTypes';

export const nbaSampleDatasetTablesPart2: SampleDatasetTable[] = [
  {
    tableName: 'player_games',
    primaryKey: 'Id',
    filePath:
      'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/player_game.csv',
    columns: [
      {
        name: 'Id',
      },
      {
        name: 'GameId',
      },
      {
        name: 'PlayerId',
      },
      {
        name: 'Date',
      },
      {
        name: 'Age',
        properties: { description: 'player age. The format is "age-days"' },
      },
      {
        name: 'Tm',
        properties: { description: 'team affiliation.' },
      },
      {
        name: 'Opp',
        properties: { description: 'opposing team.' },
      },
      {
        name: 'MP',
        properties: { description: 'minutes played' },
      },
      {
        name: 'FG',
        properties: {
          description: 'number of two point field goals made.',
        },
      },
      {
        name: 'FGA',
        properties: {
          description:
            'number of two point field goals attempted (do not include free throws).',
        },
      },
      {
        name: 'threeP',
        properties: {
          description: 'number of three point field goals made.',
        },
      },
      {
        name: 'threePA',
        properties: {
          description: 'number of three point field goals attempted.',
        },
      },
      {
        name: 'FT',
        properties: { description: 'number of free throws made.' },
      },
      {
        name: 'FTA',
        properties: { description: 'number of free throws attempted.' },
      },
      {
        name: 'ORB',
        properties: { description: 'number of offensive rebounds.' },
      },
      {
        name: 'DRB',
        properties: { description: 'number of defensive rebounds.' },
      },
      {
        name: 'AST',
        properties: { description: 'number of assists.' },
      },
      {
        name: 'STL',
        properties: { description: 'number of Steals.' },
      },
      {
        name: 'BLK',
        properties: { description: 'number of blocks.' },
      },
      {
        name: 'TOV',
        properties: { description: 'number of turnovers allowed' },
      },
      {
        name: 'PF',
        properties: { description: 'number of personal fouls' },
      },
      {
        name: 'PTS',
        properties: { description: 'total score' },
      },
    ],
    schema: [
      { columnName: 'Id', dataType: 'BIGINT' },
      { columnName: 'PlayerID', dataType: 'BIGINT' },
      { columnName: 'GameID', dataType: 'BIGINT' },
      { columnName: 'Date', dataType: 'DATE' },
      { columnName: 'Age', dataType: 'VARCHAR' }, // 35-032
      { columnName: 'Tm', dataType: 'VARCHAR' },
      { columnName: 'Opp', dataType: 'VARCHAR' },
      { columnName: 'MP', dataType: 'VARCHAR' }, // 37:25:00
      { columnName: 'FG', dataType: 'BIGINT' },
      { columnName: 'FGA', dataType: 'BIGINT' },
      { columnName: 'threeP', dataType: 'BIGINT' },
      { columnName: 'threePA', dataType: 'BIGINT' },
      { columnName: 'FT', dataType: 'BIGINT' },
      { columnName: 'FTA', dataType: 'BIGINT' },
      { columnName: 'ORB', dataType: 'BIGINT' },
      { columnName: 'DRB', dataType: 'BIGINT' },
      { columnName: 'TRB', dataType: 'BIGINT' },
      { columnName: 'AST', dataType: 'BIGINT' },
      { columnName: 'STL', dataType: 'BIGINT' },
      { columnName: 'BLK', dataType: 'BIGINT' },
      { columnName: 'TOV', dataType: 'BIGINT' },
      { columnName: 'PF', dataType: 'BIGINT' },
      { columnName: 'PTS', dataType: 'BIGINT' },
    ],
    properties: {
      description:
        'This table describes the game statistics for each NBA player in every game. Turnover percentage is the number of possessions that end in a turnover. The formula for turnover percentage (TOV%) is "TOV% = (Tov ÷ (FGA + (0.44 x FTA) + Tov)) x 100%".',
    },
  },
  {
    tableName: 'player',
    primaryKey: 'Id',
    filePath:
      'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/player.csv',
    columns: [
      {
        name: 'Id',
      },
      {
        name: 'TeamId',
      },
      {
        name: 'FullName',
      },
      {
        name: 'FirstName',
      },
      {
        name: 'LastName',
      },
    ],
    schema: [
      { columnName: 'Id', dataType: 'BIGINT' },
      { columnName: 'TeamId', dataType: 'BIGINT' },
      { columnName: 'FullName', dataType: 'VARCHAR' },
      { columnName: 'FirstName', dataType: 'VARCHAR' },
      { columnName: 'LastName', dataType: 'VARCHAR' },
    ],
    properties: {
      description:
        'This table describes NBA players by their ID, name, and team affiliation.',
    },
  },
  {
    tableName: 'team',
    primaryKey: 'Id',
    filePath: 'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/team.csv',
    columns: [
      {
        name: 'Id',
      },
      {
        name: 'FullName',
      },
      {
        name: 'Abbreviation',
      },
      {
        name: 'Nickname',
      },
      {
        name: 'City',
      },
      {
        name: 'State',
      },
      {
        name: 'YearFounded',
      },
    ],
    schema: [
      { columnName: 'Id', dataType: 'BIGINT' },
      { columnName: 'FullName', dataType: 'VARCHAR' },
      { columnName: 'Abbreviation', dataType: 'VARCHAR' },
      { columnName: 'Nickname', dataType: 'VARCHAR' },
      { columnName: 'City', dataType: 'VARCHAR' },
      { columnName: 'State', dataType: 'VARCHAR' },
      { columnName: 'YearFounded', dataType: 'INT' },
    ],
    properties: {
      description:
        'This table describes NBA teams by their ID, team name, team abbreviation, and founding date.',
    },
  },
];
