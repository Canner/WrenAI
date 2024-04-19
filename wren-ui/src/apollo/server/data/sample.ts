import { RelationType } from '../types';
import { SampleDatasetName } from './type';

export interface SampleDatasetColumn {
  name: string;
  description?: string;
}

export interface SampleDatasetSchema {
  columnName: string;
  dataType: string;
}
export interface SampleDatasetTable {
  filePath: string;
  tableName: string;
  // the column order in schema definition should be the same as the column in csv file
  schema?: SampleDatasetSchema[];
  columns?: SampleDatasetColumn[];
  description?: string;
}

export interface SampleDatasetRelationship {
  fromModelName: string;
  fromColumnName: string;
  toModelName: string;
  toColumnName: string;
  type: RelationType;
}
export interface SuggestedQuestion {
  question: string;
  label: string;
}

export interface SampleDataset {
  name: string; // SampleDatasetName
  tables: SampleDatasetTable[];
  questions?: SuggestedQuestion[];
  relations?: SampleDatasetRelationship[];
}

export const sampleDatasets: Record<string, SampleDataset> = {
  music: {
    name: SampleDatasetName.MUSIC,
    tables: [
      {
        tableName: 'album',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Album.csv',
        schema: [
          { columnName: 'AlbumId', dataType: 'INT' },
          { columnName: 'Title', dataType: 'varchar' },
          { columnName: 'ArtistId', dataType: 'INT' },
        ],
      },
      {
        tableName: 'artist',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Artist.csv',
        schema: [
          { columnName: 'ArtistId', dataType: 'INT' },
          { columnName: 'Name', dataType: 'varchar' },
        ],
      },
      {
        tableName: 'customer',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Customer.csv',
        schema: [
          { columnName: 'CustomerId', dataType: 'BIGINT' },
          { columnName: 'FirstName', dataType: 'VARCHAR' },
          { columnName: 'LastName', dataType: 'VARCHAR' },
          { columnName: 'Company', dataType: 'VARCHAR' },
          { columnName: 'Address', dataType: 'VARCHAR' },
          { columnName: 'City', dataType: 'VARCHAR' },
          { columnName: 'State', dataType: 'VARCHAR' },
          { columnName: 'Country', dataType: 'VARCHAR' },
          { columnName: 'PostalCode', dataType: 'VARCHAR' },
          { columnName: 'Phone', dataType: 'VARCHAR' },
          { columnName: 'Fax', dataType: 'VARCHAR' },
          { columnName: 'Email', dataType: 'VARCHAR' },
          { columnName: 'SupportRepId', dataType: 'BIGINT' },
        ],
      },
      {
        tableName: 'genre',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Genre.csv',
        schema: [
          { columnName: 'GenreId', dataType: 'BIGINT' },
          { columnName: 'Name', dataType: 'VARCHAR' },
        ],
      },
      {
        tableName: 'invoice',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/Invoice.csv',
        schema: [
          { columnName: 'InvoiceId', dataType: 'BIGINT' },
          { columnName: 'CustomerId', dataType: 'BIGINT' },
          { columnName: 'InvoiceDate', dataType: 'Date' },
          { columnName: 'BillingAddress', dataType: 'VARCHAR' },
          { columnName: 'BillingCity', dataType: 'VARCHAR' },
          { columnName: 'BillingState', dataType: 'VARCHAR' },
          { columnName: 'BillingCountry', dataType: 'VARCHAR' },
          { columnName: 'BillingPostalCode', dataType: 'VARCHAR' },
          { columnName: 'Total', dataType: 'DOUBLE' },
        ],
      },
      {
        tableName: 'invoiceLine',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/Music/InvoiceLine.csv',
        schema: [
          { columnName: 'InvoiceLineId', dataType: 'BIGINT' },
          { columnName: 'InvoiceId', dataType: 'BIGINT' },
          { columnName: 'TrackId', dataType: 'BIGINT' },
          { columnName: 'UnitPrice', dataType: 'DOUBLE' },
          { columnName: 'Quantity', dataType: 'BIGINT' },
        ],
      },
      {
        tableName: 'track',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Track.csv',
        schema: [
          { columnName: 'TrackId', dataType: 'BIGINT' },
          { columnName: 'Name', dataType: 'VARCHAR' },
          { columnName: 'AlbumId', dataType: 'BIGINT' },
          { columnName: 'MediaTypeId', dataType: 'BIGINT' },
          { columnName: 'GenreId', dataType: 'BIGINT' },
          { columnName: 'Composer', dataType: 'VARCHAR' },
          { columnName: 'Milliseconds', dataType: 'BIGINT' },
          { columnName: 'Bytes', dataType: 'BIGINT' },
          { columnName: 'UnitPrice', dataType: 'DOUBLE' },
        ],
      },
    ],
    questions: [
      {
        question: 'What are the top 5 selling albums in the US?',
        label: 'Ranking',
      },
      {
        question: 'What is the total revenue generated from each genre?',
        label: 'Aggregation',
      },
      {
        question:
          'Which customers have made purchases of tracks from albums in each genre?',
        label: 'General',
      },
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
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'City', dataType: 'VARCHAR' },
          { columnName: 'State', dataType: 'VARCHAR' },
        ],
        // This column is an example of a column with a description, please modify it to match the dataset
        columns: [
          {
            name: 'City',
            description:
              'The Customer City, where the customer company is located',
          },
        ],
        // This description is an example, please modify it to match the dataset
        description:
          'A table of customers who have made purchases, including their city',
      },
      {
        tableName: 'order_items',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/order_items.csv',
        schema: [
          { columnName: 'OrderId', dataType: 'VARCHAR' },
          { columnName: 'ItemNumber', dataType: 'BIGINT' },
          { columnName: 'ProductId', dataType: 'VARCHAR' },
          { columnName: 'ShippingLimitDate', dataType: 'DATE' },
          { columnName: 'Price', dataType: 'DOUBLE' },
          { columnName: 'FreightValue', dataType: 'DOUBLE' },
        ],
      },
      {
        tableName: 'orders',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/orders.csv',
        schema: [
          { columnName: 'OrderId', dataType: 'VARCHAR' },
          { columnName: 'CustomerId', dataType: 'VARCHAR' },
          { columnName: 'Status', dataType: 'VARCHAR' },
          { columnName: 'PurchaseTimestamp', dataType: 'TIMESTAMP' },
          { columnName: 'ApprovedTimestamp', dataType: 'TIMESTAMP' },
          { columnName: 'DeliveredCarrierDate', dataType: 'DATE' },
          { columnName: 'DeliveredCustomerDate', dataType: 'DATE' },
          { columnName: 'EstimatedDeliveryDate', dataType: 'DATE' },
        ],
      },
      {
        tableName: 'payments',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/payments.csv',
        schema: [
          { columnName: 'OrderId', dataType: 'VARCHAR' },
          { columnName: 'Sequential', dataType: 'BIGINT' },
          { columnName: 'Type', dataType: 'VARCHAR' },
          { columnName: 'Installments', dataType: 'BIGINT' },
          { columnName: 'Value', dataType: 'DOUBLE' },
        ],
      },
      {
        tableName: 'products',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/products.csv',
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'Category', dataType: 'VARCHAR' },
          { columnName: 'Name', dataType: 'VARCHAR' },
        ],
      },
      {
        tableName: 'reviews',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/reviews.csv',
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'OrderId', dataType: 'VARCHAR' },
          { columnName: 'Score', dataType: 'BIGINT' },
          { columnName: 'CreationTimestamp', dataType: 'TIMESTAMP' },
          { columnName: 'AnswerTimestamp', dataType: 'TIMESTAMP' },
        ],
      },
    ],
    questions: [
      {
        question:
          'What are the top 3 value for orders placed by customers in each city?',
        label: 'Ranking',
      },
      {
        question:
          'What is the average score of reviews submitted for orders placed by customers in each city?',
        label: 'Aggregation',
      },
      {
        question:
          'What is the total value of payments made by customers from each state?',
        label: 'Aggregation',
      },
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
          { columnName: '3pHome', dataType: 'BIGINT' },
          { columnName: '3paHome', dataType: 'BIGINT' },
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
          { columnName: '3pAway', dataType: 'BIGINT' },
          { columnName: '3paAway', dataType: 'BIGINT' },
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
      },
      {
        tableName: 'line_score',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/NBA/line_score.csv',
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
      },
      {
        tableName: 'player_games',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/NBA/player_game.csv',
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
          { columnName: '3P', dataType: 'BIGINT' },
          { columnName: '3PA', dataType: 'BIGINT' },
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
      },
      {
        tableName: 'player',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/player.csv',
        schema: [
          { columnName: 'Id', dataType: 'BIGINT' },
          { columnName: 'TeamId', dataType: 'BIGINT' },
          { columnName: 'FullName', dataType: 'VARCHAR' },
          { columnName: 'FirstName', dataType: 'VARCHAR' },
          { columnName: 'LastName', dataType: 'VARCHAR' },
        ],
      },
      {
        tableName: 'team',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/team.csv',
        schema: [
          { columnName: 'Id', dataType: 'BIGINT' },
          { columnName: 'FullName', dataType: 'VARCHAR' },
          { columnName: 'Abbreviation', dataType: 'VARCHAR' },
          { columnName: 'Nickname', dataType: 'VARCHAR' },
          { columnName: 'City', dataType: 'VARCHAR' },
          { columnName: 'State', dataType: 'VARCHAR' },
          { columnName: 'YearFounded', dataType: 'INT' },
        ],
      },
    ],
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
  },
};

export const buildInitSql = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];

  return selectedDataset.tables
    .map((table) => {
      const schema = table.schema
        ?.map(({ columnName, dataType }) => `'${columnName}': '${dataType}'`)
        .join(', ');
      if (!schema) {
        return `CREATE TABLE ${table.tableName} AS FROM read_csv('${table.filePath}',header=true);`;
      } else {
        return `CREATE TABLE ${table.tableName} AS FROM read_csv('${table.filePath}',header=true, columns={${schema}});`;
      }
    })
    .join('\n');
};

export const getRelations = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.relations;
};

export const getSampleAskQuestions = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.questions;
};
