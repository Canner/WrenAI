export const sampleDatasets = {
  music: {
    initSql: `\
        CREATE TABLE album AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Album.csv';
        CREATE TABLE artist AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Artist.csv';
        CREATE TABLE customer AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Customer.csv';
        CREATE TABLE genre AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Genre.csv';
        CREATE TABLE invoice AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Invoice.csv';
        CREATE TABLE invoiceLine AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/InvoiceLine.csv';
        CREATE TABLE track AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/Music/Track.csv';
    `,
  },
};
