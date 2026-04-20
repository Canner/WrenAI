import { pickBy } from 'lodash';
import { DataSourceName } from '../types';
import { Model, Project } from '../repositories';
import { Manifest, TableReference, WrenEngineDataSourceType } from './type';

export const buildTableReference = (model: Model): TableReference | null => {
  const modelProps =
    model.properties && typeof model.properties === 'string'
      ? JSON.parse(model.properties)
      : {};
  if (!modelProps.table) {
    return null;
  }
  return {
    catalog: modelProps.catalog || null,
    schema: modelProps.schema || null,
    table: modelProps.table,
  };
};

export const postProcessManifest = (manifest: Manifest) => {
  manifest.models = manifest.models?.map((model) => {
    model.columns?.map((column) => {
      column.properties = pickBy(column.properties, (value) => value !== null);
      return column;
    });
    return pickBy(model, (value) => value !== null);
  });
  manifest.views = manifest.views?.map((view) => {
    return pickBy(view, (value) => value !== null);
  });
  manifest.relationships = manifest.relationships?.map((relationship) => {
    return pickBy(relationship, (value) => value !== null);
  });
  manifest.enumDefinitions = manifest.enumDefinitions?.map((enumDefinition) => {
    return pickBy(enumDefinition, (value) => value !== null);
  });
  manifest.models?.forEach((model) => {
    model.columns?.forEach((column) => {
      if (column.expression === '') {
        delete column.expression;
      }
    });
  });
};

export const buildManifestDataSource = (
  project: Project,
): WrenEngineDataSourceType | undefined => {
  const type = project.type;
  if (!type) {
    return;
  }
  switch (type) {
    case DataSourceName.ATHENA:
      return WrenEngineDataSourceType.ATHENA;
    case DataSourceName.BIG_QUERY:
      return WrenEngineDataSourceType.BIGQUERY;
    case DataSourceName.DUCKDB:
      return WrenEngineDataSourceType.DUCKDB;
    case DataSourceName.POSTGRES:
      return WrenEngineDataSourceType.POSTGRES;
    case DataSourceName.MYSQL:
      return WrenEngineDataSourceType.MYSQL;
    case DataSourceName.ORACLE:
      return WrenEngineDataSourceType.ORACLE;
    case DataSourceName.MSSQL:
      return WrenEngineDataSourceType.MSSQL;
    case DataSourceName.CLICK_HOUSE:
      return WrenEngineDataSourceType.CLICKHOUSE;
    case DataSourceName.TRINO:
      return WrenEngineDataSourceType.TRINO;
    case DataSourceName.SNOWFLAKE:
      return WrenEngineDataSourceType.SNOWFLAKE;
    case DataSourceName.REDSHIFT:
      return WrenEngineDataSourceType.REDSHIFT;
    case DataSourceName.DATABRICKS:
      return WrenEngineDataSourceType.DATABRICKS;
    default:
      throw new Error(
        `Unsupported data source type: ${type} found when building manifest`,
      );
  }
};
