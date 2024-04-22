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
        description:
        'A table of customers who have made purchases, including their city',
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
        schema: [
          { columnName: 'Id', dataType: 'VARCHAR' },
          { columnName: 'City', dataType: 'VARCHAR' },
          { columnName: 'State', dataType: 'VARCHAR' },
        ],
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
            description: 'number of field goals made by the home team.',
          },
          {
            name: 'FgaHome',
            description: 'number of field goals attempted by the home team.',
          },
          {
            name: '3pHome',
            description:
              'number of three point field goals made by the home team.',
          },
          {
            name: '3paHome',
            description:
              'number of three point field goals attempted by the home team.',
          },
          {
            name: 'FtmHome',
            description: 'number of free throws made by the home team.',
          },
          {
            name: 'FtaHome',
            description: 'number of free throws attempted by the home team.',
          },
          {
            name: 'OrebHome',
            description: 'number of offensive rebounds by the home team.',
          },
          {
            name: 'DrebHome',
            description: 'number of defensive rebounds by the home team.',
          },
          {
            name: 'RebHome',
            description: 'number of rebounds by the home team.',
          },
          {
            name: 'AstHome',
            description: 'number of assists by the home team.',
          },
          {
            name: 'StlHome',
            description: 'number of steels by the home team.',
          },
          {
            name: 'BlkHome',
            description: 'number of bloacks by the home team.',
          },
          {
            name: 'TovHome',
            description: 'number of turnovers by the home team.',
          },
          {
            name: 'PfHome',
            description: 'number of personal fouls by the home team.',
          },
          {
            name: 'PtsHome',
            description: 'Total score of the home team.',
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
            description: 'number of field goals made by the away team.',
          },
          {
            name: 'FgaAway',
            description: 'number of field goals attempted by the away team.',
          },
          {
            name: '3pAway',
            description:
              'number of three point field goals made by the away team.',
          },
          {
            name: '3paAway',
            description:
              'number of three point field goals attempted by the away team.',
          },
          {
            name: 'FtmAway',
            description: 'number of free throws made by the away team.',
          },
          {
            name: 'FtaAway',
            description: 'number of free throws attempted by the away team.',
          },
          {
            name: 'OrebAway',
            description: 'number of offensive rebounds by the away team.',
          },
          {
            name: 'DrebAway',
            description: 'number of defensive rebounds by the away team.',
          },
          {
            name: 'RebAway',
            description: 'number of rebounds by the away team.',
          },
          {
            name: 'AstAway',
            description: 'number of assists by the away team.',
          },
          {
            name: 'StlAway',
            description: 'number of steels by the away team.',
          },
          {
            name: 'BlkAway',
            description: 'number of bloacks by the away team.',
          },
          {
            name: 'TovAway',
            description: 'number of turnovers by the away team.',
          },
          {
            name: 'PfAway',
            description: 'number of personal fouls by the away team.',
          },
          {
            name: 'PtsAway',
            description: 'Total score of the away team.',
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
            description: 'The score of the home team in the first quarter.',
          },
          {
            name: 'PtsQtr2Home',
            description: 'The score of the home team in the second quarter.',
          },
          {
            name: 'PtsQtr3Home',
            description: 'The score of the home team in the third quarter.',
          },
          {
            name: 'PtsQtr4Home',
            description: 'The score of the home team in the fourth quarter.',
          },
          {
            name: 'PtsOt1Home',
            description:
              'The score of the home team in the overtime. The value of 0 indicates that the game did not go into overtime.',
          },
          {
            name: 'PtsHome',
            description: 'Total score of the home team.',
          },
          {
            name: 'TeamIdAway',
          },
          {
            name: 'TeamWinsLossesAway',
          },
          {
            name: 'PtsQtr1Away',
            description: 'The score of the away team in the first quarter.',
          },
          {
            name: 'PtsQtr2Away',
            description: 'The score of the away team in the second quarter.',
          },
          {
            name: 'PtsQtr3Away',
            description: 'The score of the away team in the third quarter.',
          },
          {
            name: 'PtsQtr4Away',
            description: 'The score of the away team in the fourth quarter.',
          },
          {
            name: 'PtsOt1Away',
            description:
              'The score of the away team in the overtime. The value of 0 indicates that the game did not go into overtime.',
          },
          {
            name: 'PtsAway',
            description: 'Total score of the away team.',
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
      },
      {
        tableName: 'player_games',
        filePath:
          'https://wrenai-public.s3.amazonaws.com/demo/NBA/player_game.csv',
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
            description: 'player age. The format is "age-days"',
          },
          {
            name: 'Tm',
            description: 'team affiliation.',
          },
          {
            name: 'Opp',
            description: 'opposing team.',
          },
          {
            name: 'MP',
            description: 'minutes played',
          },
          {
            name: 'FG',
            description: 'number of two point field goals made.',
          },
          {
            name: 'FGA',
            description:
              'number of two point field goals attempted (do not include free throws).',
          },
          {
            name: '3P',
            description: 'number of three point field goals made.',
          },
          {
            name: '3PA',
            description: 'number of three point field goals attempted.',
          },
          {
            name: 'FT',
            description: 'number of free throws made.',
          },
          {
            name: 'FTA',
            description: 'number of free throws attempted.',
          },
          {
            name: 'ORB',
            description: 'number of offensive rebounds.',
          },
          {
            name: 'DRB',
            description: 'number of defensive rebounds.',
          },
          {
            name: 'AST',
            description: 'number of assists.',
          },
          {
            name: 'STL',
            description: 'number of Steals.',
          },
          {
            name: 'BLK',
            description: 'number of blocks.',
          },
          {
            name: 'TOV',
            description: 'number of turnovers allowed',
          },
          {
            name: 'PF',
            description: 'number of personal fouls',
          },
          {
            name: 'PTS',
            description: 'total score',
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
      },
      {
        tableName: 'team',
        filePath: 'https://wrenai-public.s3.amazonaws.com/demo/NBA/team.csv',
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
