import { RelationType } from '../types';
import { SampleDatasetName } from './type';

export interface SampleDatasetColumn {
  name: string;
  description?: string;
}
export interface SampleDatasetTable {
  filePath: string;
  tableName: string;
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

        // This column is an example of a column with a description, please modify it to match the dataset
        columns: [
          {
            name: 'City',
            description:
              'The Customer City, where the customer company is located. Also called \'customer segment\'.',
          },
          {
              name: 'Id',
              description: 'A unique identifier for each customer in the data model.'
          },
          {
              name: 'State',
              description: 'A field indicating the state where the customer is located.'
          }
        ],
        // This description is an example, please modify it to match the dataset
        description:
          'A table of customers who have made purchases, including their city',
      },
      {
        tableName: 'order_items',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/order_items.csv',
        columns: [
          {
              name: 'FreightValue',
              description: 'A numerical value representing the cost of shipping for an item in an order.'
          },
          {
              name: 'ItemNumber',
              description: 'The sequential number of the order item in this order. Each order item in an order has its unique ItemNumber'
          },
          {
              name: 'OrderId',
              description: 'A VARCHAR value indicating the order that this order_item belongs to. The column is used to map the order_item to Orders model in the OrdersOrder_items relationship'
          },
          {
              name: 'Price',
              description: 'A numerical value representing the price of an item in an order.'
          },
          {
              name: 'ProductId',
              description: 'A VARCHAR value representing the product of this order_item. The column is used to map the order_item to Products model using ProductsOrder_items relationship'
          },
          {
              name: 'ShippingLimitDate',
              description: 'A date value indicating the limit by which an item should be shipped according to the order. It helps track the deadline for shipping items in the \'order_items\' model.'
          }
        ],
        description: 'The model is used to store information about items in orders, including details like prices, product IDs, shipping limits, and relationships with orders and products tables.',
      },
      {
        tableName: 'orders',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/orders.csv',
        columns: [
          {
              name: 'ApprovedTimestamp',
              description: 'A column that represents the timestamp when the order was approved.'
          },
          {
              name: 'CustomerId',
              description: 'A unique identifier representing the customer who purchased this order.'
          },
          {
              name: 'DeliveredCarrierDate',
              description: 'A column that represents the date when the order was delivered by the carrier.'
          },
          {
              name: 'DeliveredCustomerDate',
              description: 'A column that represents the date when the order was delivered to the customer.'
          },
          {
              name: 'EstimatedDeliveryDate',
              description: 'A column that represents the estimated delivery date of the order.'
          },
          {
              name: 'OrderId',
              description: 'A column that represents a unique identifier of this order.'
          },
          {
              name: 'PurchaseTimestamp',
              description: 'A column that represents the timestamp when the order was purchased.'
          },
          {
              name: 'Status',
              description: 'A column representing the status of the order.'
          }
        ],
        description: 'A model representing the orders data.',
      },
      {
        tableName: 'payments',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/payments.csv',
        columns: [
          {
              name: 'Installments',
              description: 'A column representing the number of installments in the payments data model.'
          },
          {
              name: 'OrderId',
              description: 'A column representing the order id associated with this payment. The column is used to map the payment to the order using PaymentsOrders relationship'
          },
          {
              name: 'Sequential',
              description: 'A column representing the sequential number of the payment in its corresponding order. Each payment in the order has its unique sequential number.'
          },
          {
              name: 'Type',
              description: 'A column representing the type of payment in the payments data model.'
          },
          {
              name: 'Value',
              description: 'A column representing the value of the payment in the payments data model.'
          }
        ],
        description: 'A model representing the payment records, including installments, order IDs, sequential numbers, payment types, values, and relationships with orders.',
      },
      {
        tableName: 'products',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/products.csv',
        columns: [
          {
              name: 'Category',
              description: 'A category that classifies the products in the data model.'
          },
          {
              name: 'Id',
              description: 'A unique identifier assigned to each product in the data model.'
          },
          {
              name: 'Name',
              description: 'A name of the product in the data model.'
          }
        ],
        description: 'A data model containing information about products such as category, ID, and name, with a relationship to order items.',
      },
      {
        tableName: 'reviews',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/reviews.csv',
        columns: [
          {
              name: 'AnswerTimestamp',
              description: 'The date when the answer was provided.'
          },
          {
              name: 'CreationTimestamp',
              description: 'The date when the review was created.'
          },
          {
              name: 'Id',
              description: 'A unique identifier assigned to each review entry.'
          },
          {
              name: 'OrderId',
              description: 'The order id of the order which the review belongs to.'
          },
          {
              name: 'Score',
              description: 'The score associated with each review entry.'
          }
        ],
        description: 'A model containing information about review of orders.',
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

export const getSampleAskQuestions = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.questions;
};
