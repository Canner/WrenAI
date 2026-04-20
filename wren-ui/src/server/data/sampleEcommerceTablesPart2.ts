import type { SampleDatasetTable } from './sampleTypes';

export const ecommerceSampleDatasetTablesPart2: SampleDatasetTable[] = [
  {
    tableName: 'olist_products_dataset',
    primaryKey: 'product_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_products_dataset.parquet',
    properties: {
      displayName: 'products',
      description:
        'This table provides detailed information about products, including their category, dimensions, weight, description length, and the number of photos. Join product_category_name_translation on product_category_name when you need the English category label; that translated field is not stored directly on this table. This helps in managing product details and enhancing the shopping experience on the e-commerce platform.',
    },
    columns: [
      {
        name: 'product_category_name',
        properties: {
          description:
            'Name of the product category to which the item belongs.',
          displayName: 'product_category_name',
        },
      },
      {
        name: 'product_description_lenght',
        properties: {
          description: 'Length of the product description in characters.',
          displayName: 'product_description_lenght',
        },
      },
      {
        name: 'product_height_cm',
        properties: {
          description: 'Height of the product in centimeters.',
          displayName: 'product_height_cm',
        },
      },
      {
        name: 'product_id',
        properties: {
          description: 'Unique identifier for the product',
          displayName: 'product_id',
        },
      },
      {
        name: 'product_length_cm',
        properties: {
          description: 'Length of the product in centimeters',
          displayName: 'product_length_cm',
        },
      },
      {
        name: 'product_name_lenght',
        properties: {
          description: 'Length of the product name in characters',
          displayName: 'product_name_lenght',
        },
      },
      {
        name: 'product_photos_qty',
        properties: {
          description: 'Number of photos available for the product',
          displayName: 'product_photos_qty',
        },
      },
      {
        name: 'product_weight_g',
        properties: {
          description: 'Weight of the product in grams',
          displayName: 'product_weight_g',
        },
      },
      {
        name: 'product_width_cm',
        properties: {
          description: 'Width of the product in centimeters',
          displayName: 'product_width_cm',
        },
      },
    ],
    schema: [
      { columnName: 'product_category_name', dataType: 'VARCHAR' },
      { columnName: 'product_description_lenght', dataType: 'BIGINT' },
      { columnName: 'product_height_cm', dataType: 'BIGINT' },
      { columnName: 'product_id', dataType: 'VARCHAR' },
      { columnName: 'product_length_cm', dataType: 'BIGINT' },
      { columnName: 'product_name_lenght', dataType: 'BIGINT' },
      { columnName: 'product_photos_qty', dataType: 'BIGINT' },
      { columnName: 'product_weight_g', dataType: 'BIGINT' },
      { columnName: 'product_width_cm', dataType: 'BIGINT' },
    ],
  },
  {
    tableName: 'olist_order_reviews_dataset',
    primaryKey: 'review_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_reviews_dataset.parquet',
    properties: {
      displayName: 'order reviews',
      description:
        'This table contains customer reviews for each order, including feedback comments, ratings, and timestamps for when the review was submitted and responded to. It helps track customer satisfaction and review management on the e-commerce platform.',
    },
    columns: [
      {
        name: 'order_id',
        properties: {
          description:
            'Unique identifier linking the review to the corresponding order.',
          displayName: 'order_id',
        },
      },
      {
        name: 'review_answer_timestamp',
        properties: {
          description:
            'Date and time when the review was responded to by the seller',
          displayName: 'review_answer_timestamp',
        },
      },
      {
        name: 'review_comment_message',
        properties: {
          description:
            'Detailed feedback or comments provided by the customer regarding the order.',
          displayName: 'review_comment_message',
        },
      },
      {
        name: 'review_comment_title',
        properties: {
          description: "Summary or title of the customer's review",
          displayName: 'review_comment_title',
        },
      },
      {
        name: 'review_creation_date',
        properties: {
          description:
            'Date and time when the customer initially submitted the review.',
          displayName: 'review_creation_date',
        },
      },
      {
        name: 'review_id',
        properties: {
          description: 'Unique identifier for the specific review entry.',
          displayName: 'review_id',
        },
      },
      {
        name: 'review_score',
        properties: {
          description:
            'Numeric rating given by the customer, typically ranging from 1 (worst) to 5 (best).',
          displayName: 'review_score',
        },
      },
    ],
    schema: [
      { columnName: 'order_id', dataType: 'VARCHAR' },
      { columnName: 'review_answer_timestamp', dataType: 'TIMESTAMP' },
      { columnName: 'review_comment_message', dataType: 'VARCHAR' },
      { columnName: 'review_comment_title', dataType: 'VARCHAR' },
      { columnName: 'review_creation_date', dataType: 'TIMESTAMP' },
      { columnName: 'review_id', dataType: 'VARCHAR' },
      { columnName: 'review_score', dataType: 'BIGINT' },
    ],
  },
  {
    tableName: 'olist_geolocation_dataset',
    primaryKey: '',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_geolocation_dataset.parquet',
    properties: {
      displayName: 'geolocation',
      description:
        'This table contains detailed information about Brazilian zip codes and their corresponding latitude and longitude coordinates. It can be used to plot maps, calculate distances between sellers and customers, and perform geographic analysis.',
    },
    columns: [
      {
        name: 'geolocation_city',
        properties: {
          displayName: 'geolocation_city',
          description: 'The city name of the geolocation',
        },
      },
      {
        name: 'geolocation_lat',
        properties: {
          displayName: 'geolocation_lat',
          description: 'The coordinations for the locations latitude',
        },
      },
      {
        name: 'geolocation_lng',
        properties: {
          displayName: 'geolocation_lng',
          description: 'The coordinations for the locations longitude',
        },
      },
      {
        name: 'geolocation_state',
        properties: {
          displayName: 'geolocation_state',
          description: 'The state of the geolocation',
        },
      },
      {
        name: 'geolocation_zip_code_prefix',
        properties: {
          displayName: 'geolocation_zip_code_prefix',
          description: 'First 5 digits of zip code',
        },
      },
    ],
    schema: [
      { columnName: 'geolocation_city', dataType: 'VARCHAR' },
      { columnName: 'geolocation_lat', dataType: 'DOUBLE' },
      { columnName: 'geolocation_lng', dataType: 'DOUBLE' },
      { columnName: 'geolocation_state', dataType: 'VARCHAR' },
      { columnName: 'geolocation_zip_code_prefix', dataType: 'VARCHAR' },
    ],
  },
  {
    tableName: 'olist_sellers_dataset',
    primaryKey: '',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_sellers_dataset.parquet',
    properties: {
      displayName: 'sellers',
      description:
        'This table includes data about the sellers that fulfilled orders made. Use it to find the seller location and to identify which seller fulfilled each product.',
    },
    columns: [
      {
        name: 'seller_city',
        properties: {
          description: 'The Brazilian city where the seller is located',
          displayName: 'seller_city',
        },
      },
      {
        name: 'seller_id',
        properties: {
          description: 'Unique identifier for the seller on the platform',
          displayName: 'seller_id',
        },
      },
      {
        name: 'seller_state',
        properties: {
          description: 'The Brazilian state where the seller is located',
          displayName: 'seller_state',
        },
      },
      {
        name: 'seller_zip_code_prefix',
        properties: {
          description: 'First 5 digits of seller zip code',
          displayName: 'seller_zip_code_prefix',
        },
      },
    ],
    schema: [
      { columnName: 'seller_city', dataType: 'VARCHAR' },
      { columnName: 'seller_id', dataType: 'VARCHAR' },
      { columnName: 'seller_state', dataType: 'VARCHAR' },
      { columnName: 'seller_zip_code_prefix', dataType: 'VARCHAR' },
    ],
  },
  {
    tableName: 'product_category_name_translation',
    primaryKey: 'product_category_name',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/product_category_name_translation.parquet',
    properties: {
      displayName: 'product category name translation',
      description:
        'This table contains translations of product categories from Portuguese to English. Use this table to retrieve product_category_name_english by joining on product_category_name; the translated English label lives here rather than on olist_products_dataset.',
    },
    columns: [
      {
        name: 'product_category_name',
        properties: {
          description: 'Original name of the product category in Portuguese.',
          displayName: 'product_category_name',
        },
      },
      {
        name: 'product_category_name_english',
        properties: {
          description: 'Translated name of the product category in English.',
          displayName: 'product_category_name_english',
        },
      },
    ],
    schema: [
      { columnName: 'product_category_name', dataType: 'VARCHAR' },
      { columnName: 'product_category_name_english', dataType: 'VARCHAR' },
    ],
  },
];
