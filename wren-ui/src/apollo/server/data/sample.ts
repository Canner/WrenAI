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
  ecommerce: {
    initSql: `\
      CREATE TABLE customers AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/customers.csv';
      CREATE TABLE order_items AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/order_items.csv';
      CREATE TABLE orders AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/orders.csv';
      CREATE TABLE payments AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/payments.csv';
      CREATE TABLE products AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/products.csv';
      CREATE TABLE reviews AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/reviews.csv';
    `,
  },
  nba: {
    initSql: `
      CREATE TABLE game AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/NBA/game.csv';
      CREATE TABLE line_score AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/NBA/line_score.csv';
      CREATE TABLE player_games AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/NBA/player_game.csv';
      CREATE TABLE player AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/NBA/player.csv';
      CREATE TABLE team AS FROM 'https://wrenai-public.s3.amazonaws.com/demo/NBA/team.csv';
    `,
  },
};
