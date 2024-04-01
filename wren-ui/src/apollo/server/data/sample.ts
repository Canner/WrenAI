import { RelationType } from '../types';
import { SampleDatasetName } from './type';

export interface SampleDatasetTable {
  filePath: string;
  tableName: string;
}

export interface SampleDatasetRelationship {
  fromModelName: string;
  fromColumnName: string;
  toModelName: string;
  toColumnName: string;
  type: RelationType;
}

export interface SampleDataset {
  name: string; // SampleDatasetName
  tables: SampleDatasetTable[];
  questions?: string[];
  relations?: SampleDatasetRelationship[];
}

export const sampleDatasets: Record<string, SampleDataset> = {
  music: {
    name: SampleDatasetName.MUSIC,
    tables: [
      {
        tableName: 'album',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Album.csv',
      },
      {
        tableName: 'artist',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Artist.csv',
      },
      {
        tableName: 'customer',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Customer.csv',
      },
      {
        tableName: 'genre',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Genre.csv',
      },
      {
        tableName: 'invoice',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Invoice.csv',
      },
      {
        tableName: 'invoiceLine',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/InvoiceLine.csv',
      },
      {
        tableName: 'track',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Track.csv',
      },
    ],
    questions: [
      'What are the top 5 selling albums in the US',
      'What is the total revenue generated from each genre',
      'Which customers have made purchases of tracks from albums in each genre',
    ],
    relations: [
      {
        fromModelName: 'album',
        fromColumnName: 'ArtistId',
        toModelName: 'artist',
        toColumnName: 'ArtistId',
        type: RelationType.MANY_TO_ONE,
      },
      {
        fromModelName: 'customer',
        fromColumnName: 'CustomerId',
        toModelName: 'invoice',
        toColumnName: 'CustomerId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'genre',
        fromColumnName: 'GenreId',
        toModelName: 'track',
        toColumnName: 'GenreId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'invoice',
        fromColumnName: 'InvoiceId',
        toModelName: 'invoiceLine',
        toColumnName: 'InvoiceId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'track',
        fromColumnName: 'TrackId',
        toModelName: 'invoiceLine',
        toColumnName: 'TrackId',
        type: RelationType.ONE_TO_MANY,
      },
      // album -> track
      {
        fromModelName: 'album',
        fromColumnName: 'AlbumId',
        toModelName: 'track',
        toColumnName: 'AlbumId',
        type: RelationType.ONE_TO_MANY,
      },
    ],
  },
  ecommerce: {
    name: SampleDatasetName.ECOMMERCE,
    tables: [
      {
        tableName: 'customers',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/customers.csv',
      },
      {
        tableName: 'order_items',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/order_items.csv',
      },
      {
        tableName: 'orders',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/orders.csv',
      },
      {
        tableName: 'payments',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/payments.csv',
      },
      {
        tableName: 'products',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/products.csv',
      },
      {
        tableName: 'reviews',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/reviews.csv',
      },
    ],
    questions: [
      'What are the top 3 value for orders placed by customers in each city',
      'What is the average score of reviews submitted for orders placed by customers in each city',
      'What is the total value of payments made by customers from each state',
    ],
    relations: [
      {
        fromModelName: 'customers',
        fromColumnName: 'Id',
        toModelName: 'orders',
        toColumnName: 'CustomerId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'orders',
        fromColumnName: 'OrderId',
        toModelName: 'order_items',
        toColumnName: 'OrderId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'products',
        fromColumnName: 'Id',
        toModelName: 'order_items',
        toColumnName: 'ProductId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'orders',
        fromColumnName: 'OrderId',
        toModelName: 'reviews',
        toColumnName: 'OrderId',
        type: RelationType.ONE_TO_MANY,
      },
      {
        fromModelName: 'payments',
        fromColumnName: 'OrderId',
        toModelName: 'orders',
        toColumnName: 'OrderId',
        type: RelationType.ONE_TO_MANY,
      },
    ],
  },
  nba: {
    name: SampleDatasetName.NBA,
    tables: [
      {
        tableName: 'game',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/game.csv',
      },
      {
        tableName: 'line_score',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/NBA/line_score.csv',
      },
      {
        tableName: 'player_games',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/NBA/player_game.csv',
      },
      {
        tableName: 'player',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/player.csv',
      },
      {
        tableName: 'team',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/team.csv',
      },
    ],
    questions: [
      'How many three-pointers were made by each player in each game',
      'What is the differences in turnover rates between teams with high and low average scores',
      'Which teams had the highest average points scored per game throughout the season',
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
  },
};

export const buildInitSql = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.tables
    .map(
      (table) =>
        `CREATE TABLE ${table.tableName} AS FROM read_csv('${table.filePath}',header=true);`,
    )
    .join('\n');
};

export const getRelations = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.relations;
};
