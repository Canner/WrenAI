import { DataSourceName } from '@server/types';
import {
  Model,
  Project,
  ModelColumn,
  ModelNestedColumn,
  RelationInfo,
  View,
  BIG_QUERY_CONNECTION_INFO,
} from '../../repositories';
import { MDLBuilder, MDLBuilderBuildFromOptions } from '../mdlBuilder';
import { ModelMDL, RelationMDL, ViewMDL } from '../type';

describe('MDLBuilder', () => {
  let mdlBuilder: MDLBuilder;

  describe('build', () => {
    it('should return a manifest', () => {
      const builderOptions = {
        project: {},
        models: [],
        columns: [],
        nestedColumns: [],
        relations: [],
        relatedModels: [],
        relatedColumns: [],
        relatedRelations: [],
      } as MDLBuilderBuildFromOptions;
      mdlBuilder = new MDLBuilder(builderOptions);

      const manifest = mdlBuilder.build();
      expect(manifest).toBeDefined();
    });

    it('should return a manifest with models & columns & relations.', () => {
      // Arrange
      const project = {
        id: 1,
        type: DataSourceName.BIG_QUERY,
        displayName: 'my project',
        connectionInfo: {
          projectId: 'bq-project-id',
          datasetId: 'bq-project-id.my-dataset',
          credentials: 'my-credential',
        } as BIG_QUERY_CONNECTION_INFO,
        catalog: 'wrenai',
        schema: 'public',
        sampleDataset: null,
      } as Project;
      const models = [
        {
          id: 1,
          projectId: 1,
          displayName: 'order',
          sourceTableName: 'order',
          referenceName: 'order',
          refSql: 'SELECT * FROM order',
          cached: false,
          refreshTime: null,
          properties: JSON.stringify({
            description: 'foo table',
            schema: 'my-dataset',
            catalog: 'bq-project-id',
            table: 'order',
          }),
        },
        {
          id: 2,
          projectId: 1,
          displayName: 'customer',
          sourceTableName: 'customer',
          referenceName: 'customer',
          refSql: 'SELECT * FROM customer',
          cached: false,
          refreshTime: null,
          properties: JSON.stringify({
            schema: null,
            catalog: null,
            table: 'customer',
          }),
        },
      ] as Model[];
      const columns = [
        {
          id: 1,
          modelId: 1,
          isCalculated: false,
          displayName: 'orderKey',
          referenceName: 'orderKey',
          sourceColumnName: 'orderKey',
          aggregation: null,
          lineage: null,
          customExpression: null,
          type: 'STRING',
          notNull: true,
          isPk: true,
          properties: JSON.stringify({ description: 'bar' }),
        },
        {
          id: 2,
          modelId: 2,
          isCalculated: false,
          displayName: 'orderKey',
          referenceName: 'orderKey',
          sourceColumnName: 'orderKey',
          aggregation: null,
          lineage: null,
          customExpression: null,
          type: 'STRING',
          notNull: true,
          isPk: false,
          properties: null,
        },
        {
          id: 3,
          modelId: 2,
          isCalculated: false,
          displayName: 'event_params',
          referenceName: 'event_params',
          sourceColumnName: 'event_params',
          aggregation: null,
          lineage: null,
          customExpression: null,
          type: 'ARRAY<STRUCT<key STRING>>',
          notNull: true,
          isPk: false,
          properties: null,
        },
      ] as ModelColumn[];
      const nestedColumns = [
        {
          id: 1,
          modelId: 2,
          columnId: 3,
          columnPath: ['event_params', 'key'],
          displayName: 'event_params.key',
          referenceName: 'event_params.key',
          sourceColumnName: 'event_params.key',
          type: 'STRING',
          properties: { description: 'bar' },
        },
      ] as ModelNestedColumn[];
      const relations = [
        {
          id: 1,
          projectId: 1,
          name: 'OrderCustomer',
          fromColumnId: 1,
          toColumnId: 2,
          joinType: 'oneToMany',
          fromModelId: 1,
          fromModelName: 'order',
          fromColumnName: 'orderKey',
          toModelId: 2,
          toModelName: 'customer',
          toColumnName: 'orderKey',
          properties: JSON.stringify({
            description: 'the relationship between orders and customers',
          }),
        },
      ] as RelationInfo[];
      const builderOptions = {
        project,
        models,
        columns,
        nestedColumns,
        relations,
        relatedModels: [],
        relatedColumns: [],
        relatedRelations: [],
      } as MDLBuilderBuildFromOptions;
      mdlBuilder = new MDLBuilder(builderOptions);

      // Act
      const manifest = mdlBuilder.build();

      // Assert
      const expectedModels = [
        {
          name: 'order',
          tableReference: {
            schema: 'my-dataset',
            catalog: 'bq-project-id',
            table: 'order',
          },
          refSql: null,
          columns: [
            {
              name: 'orderKey',
              expression: '',
              type: 'STRING',
              isCalculated: false,
              notNull: true,
              properties: { description: 'bar', displayName: 'orderKey' },
            },
            {
              name: 'customer',
              type: 'customer',
              isCalculated: false,
              relationship: 'OrderCustomer',
              properties: null,
              notNull: false,
            },
          ],
          cached: false,
          refreshTime: null,
          primaryKey: 'orderKey',
          properties: {
            description: 'foo table',
            displayName: 'order',
          },
        },
        {
          name: 'customer',
          tableReference: {
            schema: null,
            catalog: null,
            table: 'customer',
          },
          refSql: null,
          columns: [
            {
              name: 'orderKey',
              expression: '',
              type: 'STRING',
              isCalculated: false,
              notNull: true,
              properties: { displayName: 'orderKey' },
            },
            {
              name: 'event_params',
              expression: '',
              type: 'ARRAY<STRUCT<key STRING>>',
              isCalculated: false,
              notNull: true,
              properties: {
                displayName: 'event_params',
                'nestedDisplayName.event_params.key': 'event_params.key',
                'nestedDescription.event_params.key': 'bar',
              },
            },
            {
              name: 'order',
              type: 'order',
              isCalculated: false,
              relationship: 'OrderCustomer',
              notNull: false,
              properties: null,
            },
          ],
          primaryKey: '',
          cached: false,
          refreshTime: null,
          properties: {
            description: undefined,
            displayName: 'customer',
          },
        },
      ] as ModelMDL[];

      const expectedRelationships = [
        {
          name: 'OrderCustomer',
          models: ['order', 'customer'],
          joinType: 'oneToMany',
          condition: '"order".orderKey = "customer".orderKey',
          properties: {
            description: 'the relationship between orders and customers',
          },
        },
      ] as RelationMDL[];

      expect(manifest.models).toEqual(expectedModels);
      expect(manifest.relationships).toEqual(expectedRelationships);
    });
  });

  it('should return a manifest with models & columns & nestedColumns & relations & views.', () => {
    // Arrange
    const project = {
      id: 1,
      type: DataSourceName.BIG_QUERY,
      displayName: 'my project',
      connectionInfo: {
        projectId: 'bq-project-id',
        datasetId: 'my-dataset',
        credentials: 'my-credential',
      } as BIG_QUERY_CONNECTION_INFO,
      catalog: 'wrenai',
      schema: 'public',
      sampleDataset: null,
    } as Project;
    const models = [
      {
        id: 1,
        projectId: 1,
        displayName: 'order',
        sourceTableName: 'order',
        referenceName: 'order',
        refSql: 'SELECT * FROM order',
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({
          description: 'foo table',
          catalog: 'bq-project-id',
          schema: 'my-dataset',
          table: 'order',
        }),
      },
      {
        id: 2,
        projectId: 1,
        displayName: 'customer',
        sourceTableName: 'customer',
        referenceName: 'customer',
        refSql: 'SELECT * FROM customer',
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({
          catalog: 'bq-project-id',
          schema: 'my-dataset',
          table: 'customer',
        }),
      },
    ] as Model[];
    const columns = [
      {
        id: 1,
        modelId: 1,
        isCalculated: false,
        displayName: 'orderKey',
        referenceName: 'orderKey',
        sourceColumnName: 'orderKey',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: true,
        properties: JSON.stringify({ description: 'bar' }),
      },
      {
        id: 2,
        modelId: 2,
        isCalculated: false,
        displayName: 'orderKey',
        referenceName: 'orderKey',
        sourceColumnName: 'orderKey',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: false,
        properties: null,
      },
      {
        id: 3,
        modelId: 2,
        isCalculated: false,
        displayName: 'event_params',
        referenceName: 'event_params',
        sourceColumnName: 'event_params',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'ARRAY<STRUCT<key STRING>>',
        notNull: true,
        isPk: false,
        properties: null,
      },
    ] as ModelColumn[];
    const nestedColumns = [
      {
        id: 1,
        modelId: 2,
        columnId: 3,
        columnPath: ['event_params', 'key'],
        displayName: 'event_params.key',
        referenceName: 'event_params.key',
        sourceColumnName: 'event_params.key',
        type: 'STRING',
        properties: { description: 'bar' },
      },
    ] as ModelNestedColumn[];
    const relations = [
      {
        id: 1,
        projectId: 1,
        name: 'OrderCustomer',
        fromColumnId: 1,
        toColumnId: 2,
        joinType: 'oneToMany',
        fromModelId: 1,
        fromModelName: 'order',
        fromColumnName: 'orderKey',
        toModelId: 2,
        toModelName: 'customer',
        toColumnName: 'orderKey',
        properties: JSON.stringify({
          description: 'the relationship between orders and customers',
        }),
      },
    ] as RelationInfo[];
    const views = [
      {
        id: 1,
        projectId: 1,
        name: 'view',
        statement: 'select * from order',
        cached: false,
        properties: JSON.stringify({
          description: 'foo view',
          displayName: 'view',
        }),
      },
    ] as View[];

    const builderOptions = {
      project,
      models,
      views,
      columns,
      nestedColumns,
      relations,
      relatedModels: [],
      relatedColumns: [],
      relatedRelations: [],
    } as MDLBuilderBuildFromOptions;
    mdlBuilder = new MDLBuilder(builderOptions);

    // Act
    const manifest = mdlBuilder.build();

    // Assert
    const expectedModels = [
      {
        name: 'order',
        refSql: null,
        tableReference: {
          schema: 'my-dataset',
          catalog: 'bq-project-id',
          table: 'order',
        },
        columns: [
          {
            name: 'orderKey',
            expression: '',
            type: 'STRING',
            isCalculated: false,
            notNull: true,
            properties: { description: 'bar', displayName: 'orderKey' },
          },
          {
            name: 'customer',
            type: 'customer',
            isCalculated: false,
            relationship: 'OrderCustomer',
            notNull: false,
            properties: null,
          },
        ],
        cached: false,
        refreshTime: null,
        primaryKey: 'orderKey',
        properties: { description: 'foo table', displayName: 'order' },
      },
      {
        name: 'customer',
        refSql: null,
        tableReference: {
          schema: 'my-dataset',
          catalog: 'bq-project-id',
          table: 'customer',
        },
        columns: [
          {
            name: 'orderKey',
            expression: '',
            type: 'STRING',
            isCalculated: false,
            notNull: true,
            properties: { displayName: 'orderKey' },
          },
          {
            name: 'event_params',
            expression: '',
            type: 'ARRAY<STRUCT<key STRING>>',
            isCalculated: false,
            notNull: true,
            properties: {
              displayName: 'event_params',
              'nestedDisplayName.event_params.key': 'event_params.key',
              'nestedDescription.event_params.key': 'bar',
            },
          },
          {
            name: 'order',
            type: 'order',
            isCalculated: false,
            relationship: 'OrderCustomer',
            notNull: false,
            properties: null,
          },
        ],
        primaryKey: '',
        cached: false,
        refreshTime: null,
        properties: { description: undefined, displayName: 'customer' },
      },
    ] as ModelMDL[];

    const expectedRelationships = [
      {
        name: 'OrderCustomer',
        models: ['order', 'customer'],
        joinType: 'oneToMany',
        condition: '"order".orderKey = "customer".orderKey',
        properties: {
          description: 'the relationship between orders and customers',
        },
      },
    ] as RelationMDL[];

    const expectedViews = [
      {
        name: 'view',
        statement: 'select * from order',
        properties: {
          description: 'foo view',
          displayName: 'view',
          viewId: '1',
        },
      },
    ] as ViewMDL[];

    expect(manifest.models).toEqual(expectedModels);
    expect(manifest.relationships).toEqual(expectedRelationships);
    expect(manifest.views).toEqual(expectedViews);
  });

  it('should return correct expression in calculated field.', () => {
    const models = [
      // customer model
      {
        id: 1,
        projectId: 1,
        displayName: 'customer',
        sourceTableName: 'customer',
        referenceName: 'customer',
        refSql: 'SELECT * FROM customer',
        cached: false,
        refreshTime: null,
        properties: null,
      },
      // order model
      {
        id: 2,
        projectId: 1,
        displayName: 'order',
        sourceTableName: 'order',
        referenceName: 'order',
        refSql: 'SELECT * FROM order',
        cached: false,
        refreshTime: null,
        properties: null,
      },
      // payment model
      {
        id: 3,
        projectId: 1,
        displayName: 'payment',
        sourceTableName: 'payment',
        referenceName: 'payment',
        refSql: 'SELECT * FROM payment',
        cached: false,
        refreshTime: null,
        properties: null,
      },
    ] as Model[];
    const columns = [
      // customer columns: id, name, total_payment
      {
        id: 1,
        modelId: 1,
        isCalculated: false,
        displayName: 'id',
        referenceName: 'id',
        sourceColumnName: 'id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: true,
        properties: null,
      },
      {
        id: 2,
        modelId: 1,
        isCalculated: false,
        displayName: 'name',
        referenceName: 'name',
        sourceColumnName: 'name',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: false,
        properties: null,
      },
      {
        id: 3,
        modelId: 1,
        isCalculated: true,
        displayName: 'total_payment',
        referenceName: 'total_payment',
        sourceColumnName: 'total_payment',
        aggregation: 'sum',
        lineage: JSON.stringify([1, 2, 8]),
        customExpression: null,
        type: 'FLOAT',
        notNull: true,
        isPk: false,
        properties: null,
      },
      // order columns: id, customer_id, payment_id
      {
        id: 4,
        modelId: 2,
        isCalculated: false,
        displayName: 'id',
        referenceName: 'id',
        sourceColumnName: 'id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: true,
        properties: null,
      },
      {
        id: 5,
        modelId: 2,
        isCalculated: false,
        displayName: 'customer_id',
        referenceName: 'customer_id',
        sourceColumnName: 'customer_id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: false,
        properties: null,
      },
      {
        id: 6,
        modelId: 2,
        isCalculated: false,
        displayName: 'payment_id',
        referenceName: 'payment_id',
        sourceColumnName: 'payment_id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: false,
        properties: null,
      },
      // payment columns: id, amount
      {
        id: 7,
        modelId: 3,
        isCalculated: false,
        displayName: 'id',
        referenceName: 'id',
        sourceColumnName: 'id',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'STRING',
        notNull: true,
        isPk: true,
        properties: null,
      },
      {
        id: 8,
        modelId: 3,
        isCalculated: false,
        displayName: 'amount',
        referenceName: 'amount',
        sourceColumnName: 'amount',
        aggregation: null,
        lineage: null,
        customExpression: null,
        type: 'FLOAT',
        notNull: true,
        isPk: false,
        properties: null,
      },
    ] as ModelColumn[];
    const relations = [
      {
        id: 1,
        projectId: 1,
        name: 'OrderCustomer',
        joinType: 'ManyToOne',
        fromModelId: 2,
        fromModelName: 'order',
        fromColumnId: 5,
        fromColumnName: 'customer_id',
        toModelId: 1,
        toModelName: 'customer',
        toColumnId: 1,
        toColumnName: 'id',
      },
      {
        id: 2,
        projectId: 1,
        name: 'OrderPayment',
        joinType: 'oneToMany',
        fromModelId: 2,
        fromModelName: 'order',
        fromColumnId: 6,
        fromColumnName: 'payment_id',
        toModelId: 3,
        toModelName: 'payment',
        toColumnId: 7,
        toColumnName: 'id',
      },
    ];
    const builderOptions = {
      project: {
        schema: 'public',
        catalog: 'wrenai',
      },
      models,
      columns,
      relations,
      relatedModels: models,
      relatedColumns: columns,
      relatedRelations: relations,
    } as MDLBuilderBuildFromOptions;
    mdlBuilder = new MDLBuilder(builderOptions);

    const manifest = mdlBuilder.build();

    const customerModel = manifest.models.find((m) => m.name === 'customer');
    const totalPaymentColumn = customerModel.columns.find(
      (c) => c.name === 'total_payment',
    );
    expect(totalPaymentColumn.expression).toEqual(
      'sum(order.payment."amount")',
    );
  });

  it.each(Object.values(DataSourceName))(
    `should return correct data source type`,
    (type) => {
      const project = {
        id: 1,
        type,
        displayName: 'my project',
        connectionInfo: {
          projectId: 'bq-project-id',
          datasetId: 'bq-project-id.my-dataset',
          credentials: 'my-credential',
        } as BIG_QUERY_CONNECTION_INFO,
        catalog: 'wrenai',
        schema: 'public',
        sampleDataset: null,
      } as Project;
      const models = [] as Model[];
      const columns = [] as ModelColumn[];
      const nestedColumns = [] as ModelNestedColumn[];
      const relations = [] as RelationInfo[];
      const views = [] as View[];
      const builderOptions = {
        project,
        models,
        columns,
        nestedColumns,
        relations,
        views,
      } as MDLBuilderBuildFromOptions;
      mdlBuilder = new MDLBuilder(builderOptions);
      const manifest = mdlBuilder.build();
      expect(manifest.dataSource).toBeDefined();
      expect(manifest.dataSource).not.toBeNull();
    },
  );
});
