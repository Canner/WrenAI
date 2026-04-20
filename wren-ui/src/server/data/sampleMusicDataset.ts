import { RelationType } from '../types';
import { SampleDatasetName } from './type';
import type { SampleDataset } from './sampleTypes';

export const musicSampleDataset: SampleDataset = {
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
      filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Artist.csv',
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
      filePath: 'https://wrenai-public.s3.amazonaws.com/demo/Music/Invoice.csv',
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
};
