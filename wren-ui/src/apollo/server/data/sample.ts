import { RelationType } from '../types';
import { SampleDatasetName } from './type';

export interface SampleDatasetColumn {
  name: string;
  properties?: Record<string, any>;
}

export interface SampleDatasetSchema {
  columnName: string;
  dataType: string;
}
export interface SampleDatasetTable {
  filePath: string;
  tableName: string;
  primaryKey?: string;
  // the column order in schema definition should be the same as the column in csv file
  schema?: SampleDatasetSchema[];
  columns?: SampleDatasetColumn[];
  properties?: Record<string, any>;
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
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/customers.csv',
        properties: {
          description:
            'A table of customers who have made purchases, including their city',
        },
        columns: [
          {
            name: 'City',
            properties: {
              description:
                'The Customer City, where the customer company is located. Also called "customer segment".',
            },
          },
          {
            name: 'Id',
            properties: {
              description:
                'A unique identifier for each customer in the data model.',
            },
          },
          {
            name: 'State',
            properties: {
              description:
                'A field indicating the state where the customer is located.',
            },
          },
        ],
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'City', dataType: 'VARCHAR' },
          { columnName: 'State', dataType: 'VARCHAR' },
        ],
      },
      {
        tableName: 'order_items',
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/order_items.csv',
        columns: [
          {
            name: 'FreightValue',
            properties: {
              description:
                'A numerical value representing the cost of shipping for an item in an order.',
            },
          },
          {
            name: 'ItemNumber',
            properties: {
              description:
                'The sequential number of the order item in this order. Each order item in an order has its unique ItemNumber.',
            },
          },
          {
            name: 'OrderId',
            properties: {
              description:
                'A VARCHAR value indicating the order that this order_item belongs to. The column is used to map the order_item to Orders model in the OrdersOrder_items relationship.',
            },
          },
          {
            name: 'Price',
            properties: {
              description:
                'A numerical value representing the price of an item in an order.',
            },
          },
          {
            name: 'ProductId',
            properties: {
              description:
                'A VARCHAR value representing the product of this order_item. The column is used to map the order_item to Products model using ProductsOrder_items relationship.',
            },
          },
          {
            name: 'ShippingLimitDate',
            properties: {
              description:
                'A date value indicating the limit by which an item should be shipped according to the order. It helps track the deadline for shipping items in the "order_items" model.',
            },
          },
        ],
        properties: {
          description:
            'The model is used to store information about items in orders, including details like prices, product IDs, shipping limits, and relationships with orders and products tables.',
        },
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
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
        primaryKey: 'OrderId',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/orders.csv',
        columns: [
          {
            name: 'ApprovedTimestamp',
            properties: {
              description:
                'A column that represents the timestamp when the order was approved.',
            },
          },
          {
            name: 'CustomerId',
            properties: {
              description:
                'A unique identifier representing the customer who purchased this order.',
            },
          },
          {
            name: 'DeliveredCarrierDate',
            properties: {
              description:
                'A column that represents the date when the order was delivered by the carrier.',
            },
          },
          {
            name: 'DeliveredCustomerDate',
            properties: {
              description:
                'A column that represents the date when the order was delivered to the customer.',
            },
          },
          {
            name: 'EstimatedDeliveryDate',
            properties: {
              description:
                'A column that represents the estimated delivery date of the order.',
            },
          },
          {
            name: 'OrderId',
            properties: {
              description:
                'A column that represents a unique identifier of this order.',
            },
          },
          {
            name: 'PurchaseTimestamp',
            properties: {
              description:
                'A column that represents the timestamp when the order was purchased.',
            },
          },
          {
            name: 'Status',
            properties: {
              description: 'A column representing the status of the order.',
            },
          },
        ],
        properties: { description: 'A model representing the orders data.' },
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
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/payments.csv',
        columns: [
          {
            name: 'Installments',
            properties: {
              description:
                'A column representing the number of installments in the payments data model.',
            },
          },
          {
            name: 'OrderId',
            properties: {
              description:
                'A column representing the order id associated with this payment. The column is used to map the payment to the order using PaymentsOrders relationship.',
            },
          },
          {
            name: 'Sequential',
            properties: {
              description:
                'A column representing the sequential number of the payment in its corresponding order. Each payment in the order has its unique sequential number.',
            },
          },
          {
            name: 'Type',
            properties: {
              description:
                'A column representing the type of payment in the payments data model.',
            },
          },
          {
            name: 'Value',
            properties: {
              description:
                'A column representing the value of the payment in the payments data model.',
            },
          },
        ],
        properties: {
          description:
            'A model representing the payment records, including installments, order IDs, sequential numbers, payment types, values, and relationships with orders.',
        },
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'OrderId', dataType: 'VARCHAR' },
          { columnName: 'Sequential', dataType: 'BIGINT' },
          { columnName: 'Type', dataType: 'VARCHAR' },
          { columnName: 'Installments', dataType: 'BIGINT' },
          { columnName: 'Value', dataType: 'DOUBLE' },
        ],
      },
      {
        tableName: 'products',
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/products.csv',
        columns: [
          {
            name: 'Category',
            properties: {
              description:
                'A category that classifies the products in the data model.',
            },
          },
          {
            name: 'Id',
            properties: {
              description:
                'A unique identifier assigned to each product in the data model.',
            },
          },
          {
            name: 'Name',
            properties: {
              description: 'A name of the product in the data model.',
            },
          },
        ],
        properties: {
          description:
            'A data model containing information about products such as category, ID, and name, with a relationship to order items.',
        },
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'Category', dataType: 'VARCHAR' },
          { columnName: 'Name', dataType: 'VARCHAR' },
        ],
      },
      {
        tableName: 'reviews',
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/E-Commerce/reviews.csv',
        columns: [
          {
            name: 'AnswerTimestamp',
            properties: {
              description: 'The date when the answer was provided.',
            },
          },
          {
            name: 'CreationTimestamp',
            properties: {
              description: 'The date when the review was created.',
            },
          },
          {
            name: 'Id',
            properties: {
              description: 'A unique identifier assigned to each review entry.',
            },
          },
          {
            name: 'OrderId',
            properties: {
              description:
                'The order id of the order which the review belongs to.',
            },
          },
          {
            name: 'Score',
            properties: {
              description: 'The score associated with each review entry.',
            },
          },
        ],
        properties: {
          description: 'A model containing information about review of orders.',
        },
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
        type: RelationType.MANY_TO_ONE,
      },
    ],
  },
  nba: {
    name: SampleDatasetName.NBA,
    tables: [
      {
        tableName: 'game',
        primaryKey: 'Id',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/game.csv',
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
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/v0.3.0/NBA/team.csv',
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
