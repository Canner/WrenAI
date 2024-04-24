import {
  Model,
  Project,
  ModelColumn,
  RelationInfo,
  View,
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
        type: 'bigquery',
        displayName: 'my project',
        projectId: 'bq-project-id',
        datasetId: 'my-dataset',
        credentials: 'my-credential',
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
          properties: JSON.stringify({ description: 'foo table' }),
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
          properties: null,
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
          diagram: null,
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
          diagram: null,
          customExpression: null,
          type: 'STRING',
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
          fromColumnId: 1,
          toColumnId: 2,
          joinType: 'oneToMany',
          fromModelId: 1,
          fromModelName: 'order',
          fromColumnName: 'orderKey',
          toModelId: 2,
          toModelName: 'customer',
          toColumnName: 'orderKey',
        },
      ] as RelationInfo[];
      const builderOptions = {
        project,
        models,
        columns,
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
          refSql: 'SELECT * FROM order',
          columns: [
            {
              name: 'orderKey',
              expression: '',
              type: 'STRING',
              isCalculated: false,
              notNull: true,
              properties: { description: 'bar' },
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
          properties: { description: 'foo table' },
        },
        {
          name: 'customer',
          refSql: 'SELECT * FROM customer',
          columns: [
            {
              name: 'orderKey',
              expression: '',
              type: 'STRING',
              isCalculated: false,
              notNull: true,
              properties: null,
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
          properties: null,
        },
      ] as ModelMDL[];

      const expectedRelationships = [
        {
          name: 'OrderCustomer',
          models: ['order', 'customer'],
          joinType: 'oneToMany',
          condition: '"order".orderKey = "customer".orderKey',
        },
      ] as RelationMDL[];

      expect(manifest.models).toEqual(expectedModels);
      expect(manifest.relationships).toEqual(expectedRelationships);
    });
  });

  it('should return a manifest with models & columns & relations & views.', () => {
    // Arrange
    const project = {
      id: 1,
      type: 'bigquery',
      displayName: 'my project',
      projectId: 'bq-project-id',
      datasetId: 'my-dataset',
      credentials: 'my-credential',
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
        properties: JSON.stringify({ description: 'foo table' }),
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
        properties: null,
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
        diagram: null,
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
        diagram: null,
        customExpression: null,
        type: 'STRING',
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
        fromColumnId: 1,
        toColumnId: 2,
        joinType: 'oneToMany',
        fromModelId: 1,
        fromModelName: 'order',
        fromColumnName: 'orderKey',
        toModelId: 2,
        toModelName: 'customer',
        toColumnName: 'orderKey',
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
        refSql: 'SELECT * FROM order',
        columns: [
          {
            name: 'orderKey',
            expression: '',
            type: 'STRING',
            isCalculated: false,
            notNull: true,
            properties: { description: 'bar' },
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
        properties: { description: 'foo table' },
      },
      {
        name: 'customer',
        refSql: 'SELECT * FROM customer',
        columns: [
          {
            name: 'orderKey',
            expression: '',
            type: 'STRING',
            isCalculated: false,
            notNull: true,
            properties: null,
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
        properties: null,
      },
    ] as ModelMDL[];

    const expectedRelationships = [
      {
        name: 'OrderCustomer',
        models: ['order', 'customer'],
        joinType: 'oneToMany',
        condition: '"order".orderKey = "customer".orderKey',
      },
    ] as RelationMDL[];

    const expectedViews = [
      {
        name: 'view',
        statement: 'select * from order',
        properties: { description: 'foo view', displayName: 'view' },
      },
    ] as ViewMDL[];

    expect(manifest.models).toEqual(expectedModels);
    expect(manifest.relationships).toEqual(expectedRelationships);
    expect(manifest.views).toEqual(expectedViews);
  });
});
