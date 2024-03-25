import { Model, Project, ModelColumn, RelationInfo } from '../../repositories';
import { MDLBuilder, MDLBuilderBuildFromOptions } from '../mdlBuilder';
import { ModelMDL, RelationMDL } from '../type';

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
        catalog: 'tbd',
        schema: 'tbd',
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
          condition: 'order.orderKey = customer.orderKey',
        },
      ] as RelationMDL[];

      expect(manifest.models).toEqual(expectedModels);
      expect(manifest.relationships).toEqual(expectedRelationships);
    });
  });
});
