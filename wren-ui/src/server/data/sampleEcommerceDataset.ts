import { RelationType } from '../types';
import { SampleDatasetName } from './type';
import type { SampleDataset } from './sampleTypes';
import { ecommerceSampleDatasetTablesPart1 } from './sampleEcommerceTablesPart1';
import { ecommerceSampleDatasetTablesPart2 } from './sampleEcommerceTablesPart2';

export const ecommerceSampleDataset: SampleDataset = {
  name: SampleDatasetName.ECOMMERCE,
  tables: [
    ...ecommerceSampleDatasetTablesPart1,
    ...ecommerceSampleDatasetTablesPart2,
  ],
  questions: [
    {
      question: 'Which are the top 3 cities with the highest number of orders?',
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
    // orders
    // orders -> customers
    {
      fromModelName: 'olist_orders_dataset',
      fromColumnName: 'customer_id',
      toModelName: 'olist_customers_dataset',
      toColumnName: 'customer_id',
      type: RelationType.MANY_TO_ONE,
    },
    // orders -> items
    {
      fromModelName: 'olist_orders_dataset',
      fromColumnName: 'order_id',
      toModelName: 'olist_order_items_dataset',
      toColumnName: 'order_id',
      type: RelationType.ONE_TO_MANY,
    },
    // orders -> reviews
    {
      fromModelName: 'olist_orders_dataset',
      fromColumnName: 'order_id',
      toModelName: 'olist_order_reviews_dataset',
      toColumnName: 'order_id',
      type: RelationType.ONE_TO_MANY,
    },
    // orders -> payments
    {
      fromModelName: 'olist_orders_dataset',
      fromColumnName: 'order_id',
      toModelName: 'olist_order_payments_dataset',
      toColumnName: 'order_id',
      type: RelationType.ONE_TO_MANY,
    },
    // items -> products
    {
      fromModelName: 'olist_order_items_dataset',
      fromColumnName: 'product_id',
      toModelName: 'olist_products_dataset',
      toColumnName: 'product_id',
      type: RelationType.MANY_TO_ONE,
    },
    // items -> sellers
    {
      fromModelName: 'olist_order_items_dataset',
      fromColumnName: 'seller_id',
      toModelName: 'olist_sellers_dataset',
      toColumnName: 'seller_id',
      type: RelationType.MANY_TO_ONE,
    },
    // geolocation -> customers (zip code prefix)
    {
      fromModelName: 'olist_geolocation_dataset',
      fromColumnName: 'geolocation_zip_code_prefix',
      toModelName: 'olist_customers_dataset',
      toColumnName: 'customer_zip_code_prefix',
      type: RelationType.ONE_TO_MANY,
    },
    // geolocation -> sellers (zip code prefix)
    {
      fromModelName: 'olist_geolocation_dataset',
      fromColumnName: 'geolocation_zip_code_prefix',
      toModelName: 'olist_sellers_dataset',
      toColumnName: 'seller_zip_code_prefix',
      type: RelationType.ONE_TO_MANY,
    },
    // product category name translation -> products
    {
      fromModelName: 'product_category_name_translation',
      fromColumnName: 'product_category_name',
      toModelName: 'olist_products_dataset',
      toColumnName: 'product_category_name',
      type: RelationType.ONE_TO_MANY,
      description:
        'Use this relationship to fetch product_category_name_english from product_category_name_translation. The English category label is stored on the translation table, not directly on products.',
    },
  ],
};
