import type { SampleDatasetTable } from './sampleTypes';

export const ecommerceSampleDatasetTablesPart1: SampleDatasetTable[] = [
  {
    tableName: 'olist_customers_dataset',
    primaryKey: 'customer_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_customers_dataset.parquet',
    properties: {
      displayName: 'customers',
    },
    columns: [
      {
        name: 'customer_city',
        properties: {
          description: 'Name of the city where the customer is located',
          displayName: 'customer_city',
        },
      },
      {
        name: 'customer_id',
        properties: {
          description: null,
          displayName: 'customer_id',
        },
      },
      {
        name: 'customer_state',
        properties: {
          description: 'Name of the state where the customer is located',
          displayName: 'customer_state',
        },
      },
      {
        name: 'customer_unique_id',
        properties: {
          description: 'Unique id of the customer',
          displayName: 'customer_unique_id',
        },
      },
      {
        name: 'customer_zip_code_prefix',
        properties: {
          description: 'First 5 digits of customer zip code',
          displayName: 'customer_zip_code_prefix',
        },
      },
    ],
    schema: [
      { columnName: 'customer_city', dataType: 'VARCHAR' },
      { columnName: 'customer_id', dataType: 'VARCHAR' },
      { columnName: 'customer_state', dataType: 'VARCHAR' },
      { columnName: 'customer_unique_id', dataType: 'VARCHAR' },
      { columnName: 'customer_zip_code_prefix', dataType: 'VARCHAR' },
    ],
  },
  {
    tableName: 'olist_order_items_dataset',
    primaryKey: 'order_item_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_items_dataset.parquet',
    properties: {
      displayName: 'order items',
      description:
        'This table contains the information related to a specific order containing its shipping cost, products, cost, number of order items, and the seller.',
    },
    columns: [
      {
        name: 'freight_value',
        properties: {
          description:
            'Cost of shipping associated with the specific order item',
          displayName: 'freight_value',
        },
      },
      {
        name: 'order_id',
        properties: {
          description: 'Unique identifier for the order across the platform',
          displayName: 'order_id',
        },
      },
      {
        name: 'order_item_id',
        properties: {
          description:
            'Unique identifier for each item within a specific order',
          displayName: 'order_item_id',
        },
      },
      {
        name: 'price',
        properties: {
          description: 'Price of the individual item within the order',
          displayName: 'price',
        },
      },
      {
        name: 'product_id',
        properties: {
          description: 'Unique identifier for the product sold in the order.',
          displayName: 'product_id',
        },
      },
      {
        name: 'seller_id',
        properties: {
          description:
            'Unique identifier of the seller who fulfilled the order item.',
          displayName: 'seller_id',
        },
      },
      {
        name: 'shipping_limit_date',
        properties: {
          description:
            'Deadline for the order item to be shipped by the seller.',
          displayName: 'shipping_limit_date',
        },
      },
    ],
    schema: [
      { columnName: 'freight_value', dataType: 'DOUBLE' },
      { columnName: 'order_id', dataType: 'VARCHAR' },
      { columnName: 'order_item_id', dataType: 'BIGINT' },
      { columnName: 'price', dataType: 'DOUBLE' },
      { columnName: 'product_id', dataType: 'VARCHAR' },
      { columnName: 'seller_id', dataType: 'VARCHAR' },
      { columnName: 'shipping_limit_date', dataType: 'TIMESTAMP' },
    ],
  },
  {
    tableName: 'olist_orders_dataset',
    primaryKey: 'order_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_orders_dataset.parquet',
    properties: {
      displayName: 'orders',
      description:
        'This table contains detailed information about customer orders, including timestamps for various stages of the order process (approval, shipping, delivery), as well as the order status and customer identification. It helps track the lifecycle of an order from purchase to delivery.',
    },
    columns: [
      {
        name: 'customer_id',
        properties: {
          description:
            'Unique identifier for the customer who placed the order.',
          displayName: 'customer_id',
        },
      },
      {
        name: 'order_approved_at',
        properties: {
          description:
            'Date and time when the order was approved for processing.',
          displayName: 'order_approved_at',
        },
      },
      {
        name: 'order_delivered_carrier_date',
        properties: {
          description:
            'Date when the order was handed over to the carrier or freight forwarder for delivery.',
          displayName: 'order_delivered_carrier_date',
        },
      },
      {
        name: 'order_delivered_customer_date',
        properties: {
          description: 'Date when the order was delivered to the customer.',
          displayName: 'order_delivered_customer_date',
        },
      },
      {
        name: 'order_estimated_delivery_date',
        properties: {
          description: 'Expected delivery date based on the initial estimate.',
          displayName: 'order_estimated_delivery_date',
        },
      },
      {
        name: 'order_id',
        properties: {
          description: 'Unique identifier for the specific order',
          displayName: 'order_id',
        },
      },
      {
        name: 'order_purchase_timestamp',
        properties: {
          description:
            'Date and time when the order was placed by the customer.',
          displayName: 'order_purchase_timestamp',
        },
      },
      {
        name: 'order_status',
        properties: {
          description:
            'Current status of the order (e.g., delivered, shipped, canceled).',
          displayName: 'order_status',
        },
      },
    ],
    schema: [
      { columnName: 'customer_id', dataType: 'VARCHAR' },
      { columnName: 'order_approved_at', dataType: 'TIMESTAMP' },
      { columnName: 'order_delivered_carrier_date', dataType: 'TIMESTAMP' },
      {
        columnName: 'order_delivered_customer_date',
        dataType: 'TIMESTAMP',
      },
      {
        columnName: 'order_estimated_delivery_date',
        dataType: 'TIMESTAMP',
      },
      { columnName: 'order_id', dataType: 'VARCHAR' },
      { columnName: 'order_purchase_timestamp', dataType: 'TIMESTAMP' },
      { columnName: 'order_status', dataType: 'VARCHAR' },
    ],
  },
  {
    tableName: 'olist_order_payments_dataset',
    primaryKey: 'order_id',
    filePath:
      'https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_payments_dataset.parquet',
    properties: {
      displayName: 'order payments',
      description:
        'This table contains information about payment details for each order, including payment methods, amounts, installment plans, and payment sequences, helping to track how orders were paid and processed within the e-commerce platform.',
    },
    columns: [
      {
        name: 'order_id',
        properties: {
          description:
            'Unique identifier for the order associated with the payment.',
          displayName: 'order_id',
        },
      },
      {
        name: 'payment_installments',
        properties: {
          description:
            'Number of installments the payment is divided into for the order.',
          displayName: 'payment_installments',
        },
      },
      {
        name: 'payment_sequential',
        properties: {
          description:
            'Sequence number for tracking multiple payments within the same order.',
          displayName: 'payment_sequential',
        },
      },
      {
        name: 'payment_type',
        properties: {
          description:
            'Method used for the payment, such as credit card, debit, or voucher.',
          displayName: 'payment_type',
        },
      },
      {
        name: 'payment_value',
        properties: {
          description: 'Total amount paid in the specific transaction.',
          displayName: 'payment_value',
        },
      },
    ],
    schema: [
      { columnName: 'order_id', dataType: 'VARCHAR' },
      { columnName: 'payment_installments', dataType: 'BIGINT' },
      { columnName: 'payment_sequential', dataType: 'BIGINT' },
      { columnName: 'payment_type', dataType: 'VARCHAR' },
      { columnName: 'payment_value', dataType: 'DOUBLE' },
    ],
  },
];
