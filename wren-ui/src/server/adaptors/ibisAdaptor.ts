import axios, { AxiosResponse } from 'axios';

import { getLogger } from '@server/utils/logger';
import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import * as Errors from '@server/utils/error';
import { getConfig } from '@server/config';
import { toDockerHost } from '@server/utils';
import {
  CompactColumn,
  CompactTable,
  DEFAULT_PREVIEW_LIMIT,
  RecommendConstraint,
} from '@server/services';
import { snakeCase } from 'lodash';
import { WREN_AI_CONNECTION_INFO } from '../repositories';
import {
  toIbisConnectionInfo,
  toMultipleIbisConnectionInfos,
} from '../dataSource';
import { DialectSQL, WrenSQL } from '../models/adaptor';
import {
  DryRunResponse,
  IbisDryPlanOptions,
  IbisQueryOptions,
  IbisQueryResponse,
  IIbisAdaptor,
  ValidationResponse,
  ValidationRules,
} from './ibisAdaptorTypes';
import {
  resolveDataSourceUrl,
  resolveIbisErrorMessage,
} from './ibisAdaptorSupport';

export type {
  DryRunResponse,
  HostBasedConnectionInfo,
  IbisAthenaConnectionInfo,
  IbisBaseOptions,
  IbisBigQueryConnectionInfo,
  IbisDatabricksConnectionInfo,
  IbisDryPlanOptions,
  IbisPostgresConnectionInfo,
  IbisQueryOptions,
  IbisQueryResponse,
  IbisRedshiftConnectionInfo,
  IbisResponse,
  IbisSnowflakeConnectionInfo,
  IbisTrinoConnectionInfo,
  IIbisAdaptor,
  TableResponse,
  UrlBasedConnectionInfo,
  ValidationResponse,
} from './ibisAdaptorTypes';
export {
  IbisDatabricksConnectionType,
  IbisRedshiftConnectionType,
  SupportedDataSource,
  ValidationRules,
} from './ibisAdaptorTypes';
export type { WrenSQL };

const logger = getLogger('IbisAdaptor');
logger.level = 'debug';

const config = getConfig();

enum IBIS_API_TYPE {
  QUERY = 'QUERY',
  DRY_RUN = 'DRY_RUN',
  DRY_PLAN = 'DRY_PLAN',
  METADATA = 'METADATA',
  VALIDATION = 'VALIDATION',
  ANALYSIS = 'ANALYSIS',
  MODEL_SUBSTITUTE = 'MODEL_SUBSTITUTE',
}

export class IbisAdaptor implements IIbisAdaptor {
  private ibisServerEndpoint: string;

  constructor({ ibisServerEndpoint }: { ibisServerEndpoint: string }) {
    this.ibisServerEndpoint = ibisServerEndpoint;
  }
  public async getNativeSql(options: IbisDryPlanOptions): Promise<string> {
    const { dataSource, mdl, sql } = options;
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    const body = {
      sql,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.DRY_PLAN)}/connector/${dataSourceUrl}/dry-plan`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Dry plan error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(e, 'Error during dry plan execution');
    }
  }

  public async query(
    query: string,
    options: IbisQueryOptions,
  ): Promise<IbisQueryResponse> {
    const { dataSource, mdl } = options;
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const queryString = this.buildQueryString(options);
    const body = {
      sql: query,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.QUERY)}/connector/${dataSourceUrl}/query${queryString}`,
        body,
        {
          params: {
            limit: options.limit || DEFAULT_PREVIEW_LIMIT,
          },
        },
      );
      return {
        ...res.data,
        correlationId: res.headers['x-correlation-id'],
        processTime: res.headers['x-process-time'],
        cacheHit: res.headers['x-cache-hit'] === 'true',
        cacheCreatedAt:
          res.headers['x-cache-create-at'] &&
          new Date(parseInt(res.headers['x-cache-create-at'])).toISOString(),
        cacheOverrodeAt:
          res.headers['x-cache-override-at'] &&
          new Date(parseInt(res.headers['x-cache-override-at'])).toISOString(),
        override: res.headers['x-cache-override'] === 'true',
      };
    } catch (e) {
      logger.debug(`Query error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(e, 'Error querying ibis server');
    }
  }

  public async dryRun(
    query: string,
    options: IbisQueryOptions,
  ): Promise<DryRunResponse> {
    const { dataSource, mdl } = options;
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    const connectionInfo = this.updateConnectionInfo(options.connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      sql: query,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    logger.debug(`Dry run sql from ibis with body:`);
    try {
      const response = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.DRY_RUN)}/connector/${dataSourceUrl}/query?dryRun=true`,
        body,
      );
      logger.debug(`Ibis server Dry run success`);
      return {
        correlationId: response.headers['x-correlation-id'],
        processTime: response.headers['x-process-time'],
      };
    } catch (err) {
      logger.debug(`Dry run error: ${resolveIbisErrorMessage(err)}`);
      this.throwError(err, 'Error during dry run execution');
    }
  }

  public async getTables(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<CompactTable[]> {
    try {
      const dataSourceUrl = resolveDataSourceUrl(dataSource);
      const getTablesByConnectionInfo = async (
        ibisConnectionInfo: Record<string, unknown>,
      ) => {
        const body = {
          connectionInfo: ibisConnectionInfo,
        };
        logger.debug(`Getting tables from ibis`);
        const res: AxiosResponse<CompactTable[]> = await axios.post(
          `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrl}/metadata/tables`,
          body,
        );

        return this.transformDescriptionToProperties(res.data);
      };

      connectionInfo = this.updateConnectionInfo(connectionInfo);

      // If the dataSource supports multiple connection info, we need to get tables from each connection info
      const multipleIbisConnectionInfos = toMultipleIbisConnectionInfos(
        dataSource,
        connectionInfo,
      );
      if (multipleIbisConnectionInfos) {
        const results = await Promise.all(
          multipleIbisConnectionInfos.map(getTablesByConnectionInfo),
        );
        return results.flat();
      }

      // If the dataSource does not support multiple connection info, we only need to get tables from one connection info
      const ibisConnectionInfo = toIbisConnectionInfo(
        dataSource,
        connectionInfo,
      );
      return await getTablesByConnectionInfo(ibisConnectionInfo);
    } catch (e) {
      logger.debug(`Get tables error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(e, 'Error getting table from ibis server');
    }
  }

  public async getConstraints(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<RecommendConstraint[]> {
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
    };
    try {
      logger.debug(`Getting constraint from ibis`);
      const res: AxiosResponse<RecommendConstraint[]> = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrl}/metadata/constraints`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Get constraints error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(e, 'Error getting constraint from ibis server');
    }
  }

  public async validate(
    dataSource: DataSourceName,
    validationRule: ValidationRules,
    connectionInfo: WREN_AI_CONNECTION_INFO,
    mdl: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidationResponse> {
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
      parameters,
    };
    try {
      logger.debug(`Run validation rule "${validationRule}" with ibis`);
      await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.VALIDATION)}/connector/${dataSourceUrl}/validate/${snakeCase(validationRule)}`,
        body,
      );
      return { valid: true, message: null };
    } catch (e) {
      const errorMessage = resolveIbisErrorMessage(e);
      logger.debug(`Validation error: ${errorMessage}`);
      return { valid: false, message: errorMessage };
    }
  }

  public async modelSubstitute(
    sql: DialectSQL,
    options: {
      dataSource: DataSourceName;
      connectionInfo: WREN_AI_CONNECTION_INFO;
      mdl: Manifest;
      catalog?: string;
      schema?: string;
    },
  ): Promise<WrenSQL> {
    const { dataSource, mdl, catalog, schema } = options;
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    let connectionInfo = options.connectionInfo;
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const headers = {
      'X-User-CATALOG': catalog,
      'X-User-SCHEMA': schema,
    };
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      sql,
      connectionInfo: ibisConnectionInfo,
      manifestStr: Buffer.from(JSON.stringify(mdl)).toString('base64'),
    };
    try {
      logger.debug(`Running model substitution with ibis`);
      const res = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.MODEL_SUBSTITUTE)}/connector/${dataSourceUrl}/model-substitute`,
        body,
        {
          headers,
        },
      );
      return res.data as WrenSQL;
    } catch (e) {
      logger.debug(`Model substitution error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(
        e,
        'Error running model substitution with ibis server',
        this.modelSubstituteErrorMessageBuilder,
      );
    }
  }

  public async getVersion(
    dataSource: DataSourceName,
    connectionInfo: WREN_AI_CONNECTION_INFO,
  ): Promise<string> {
    const dataSourceUrl = resolveDataSourceUrl(dataSource);
    connectionInfo = this.updateConnectionInfo(connectionInfo);
    const ibisConnectionInfo = toIbisConnectionInfo(dataSource, connectionInfo);
    const body = {
      connectionInfo: ibisConnectionInfo,
    };
    try {
      logger.debug(`Getting version from ibis`);
      const res: AxiosResponse<string> = await axios.post(
        `${this.ibisServerEndpoint}/${this.getIbisApiVersion(IBIS_API_TYPE.METADATA)}/connector/${dataSourceUrl}/metadata/version`,
        body,
      );
      return res.data;
    } catch (e) {
      logger.debug(`Get version error: ${resolveIbisErrorMessage(e)}`);
      this.throwError(e, 'Error getting version from ibis server');
    }
  }

  private updateConnectionInfo(connectionInfo: any) {
    if (
      config.otherServiceUsingDocker &&
      Object.hasOwnProperty.call(connectionInfo, 'host')
    ) {
      connectionInfo.host = toDockerHost(connectionInfo.host);
      logger.debug(`Host replaced with docker host`);
    }
    return connectionInfo;
  }

  private transformDescriptionToProperties(
    tables: CompactTable[],
  ): CompactTable[] {
    const handleColumnProperties = (column: CompactColumn): CompactColumn => {
      const properties = column?.properties || {};
      if (column.description) {
        properties.description = column.description;
      }
      const nestedColumns = column.nestedColumns?.map((nc) => {
        return handleColumnProperties(nc);
      });
      return { ...column, properties, nestedColumns };
    };

    return tables.map((table) => {
      try {
        const properties = table?.properties || {};
        if (table.description) {
          properties.description = table.description;
        }
        if (table.columns) {
          const transformedColumns = table.columns.map((column) =>
            handleColumnProperties(column),
          );
          table.columns = transformedColumns;
        }
        return { ...table, properties };
      } catch (error) {
        logger.debug(
          `Error transforming table properties: ${resolveIbisErrorMessage(error)}`,
        );
        return table;
      }
    });
  }

  private getIbisApiVersion(apiType: IBIS_API_TYPE) {
    if (!config.experimentalEngineRustVersion) {
      return 'v2';
    }
    const useV3 = [
      IBIS_API_TYPE.QUERY,
      IBIS_API_TYPE.DRY_RUN,
      IBIS_API_TYPE.DRY_PLAN,
      IBIS_API_TYPE.VALIDATION,
      IBIS_API_TYPE.MODEL_SUBSTITUTE,
    ].includes(apiType);
    if (useV3) logger.debug('Using ibis v3 api');
    return useV3 ? 'v3' : 'v2';
  }

  private throwError(
    e: unknown,
    defaultMessage: string,
    errorMessageBuilder?: (message: string) => string,
  ): never {
    const axiosError =
      axios.isAxiosError(e) || (e && typeof e === 'object' && 'response' in e)
        ? (e as {
            response?: {
              data?: Record<string, any> | string;
              headers?: Record<string, any>;
            };
          })
        : null;
    const resolvedErrorMessage = resolveIbisErrorMessage(e);
    const customMessage =
      (typeof axiosError?.response?.data === 'object'
        ? axiosError?.response?.data?.message
        : undefined) ||
      resolvedErrorMessage ||
      defaultMessage;

    const errorData = axiosError?.response?.data;
    const errorHeaders = axiosError?.response?.headers || {};
    const errorDataObject =
      errorData && typeof errorData === 'object' ? errorData : undefined;
    throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
      customMessage: errorMessageBuilder
        ? errorMessageBuilder(customMessage)
        : customMessage,
      originalError: e instanceof Error ? e : undefined,
      other: {
        correlationId: errorHeaders['x-correlation-id'],
        processTime: errorHeaders['x-process-time'],
        ...(errorDataObject || {}),
      },
    });
  }

  private modelSubstituteErrorMessageBuilder(message: string) {
    const ModelSubstituteErrorEnum = {
      MODEL_NOT_FOUND: () => {
        return message.includes('Model not found');
      },
      PARSING_EXCEPTION: () => {
        return message.includes('sql.parser.ParsingException');
      },
    };
    if (ModelSubstituteErrorEnum.MODEL_NOT_FOUND()) {
      const modelName = message.split(': ')[1];
      const dotCount = modelName.split('.').length - 1;
      switch (dotCount) {
        case 0:
          return (
            message +
            `. Try adding both catalog and schema before your table name. e.g. my_database.public.${modelName}`
          );
        case 1:
          return (
            message +
            `. Try adding the catalog before the schema in your table name. e.g. my_database.${modelName}`
          );
        case 2:
          return (
            message +
            `. It may be missing from models, misnamed, or have a case mismatch.`
          );
        default:
          return (
            message +
            `. It may be missing from models, misnamed, or have a case mismatch.`
          );
      }
    } else if (ModelSubstituteErrorEnum.PARSING_EXCEPTION()) {
      return (
        message +
        '. Please check your selected column and make sure its quoted for columns with non-alphanumeric characters.'
      );
    }
    return message;
  }

  private buildQueryString(options: IbisQueryOptions) {
    if (!options.cacheEnabled) {
      return '';
    }
    const queryString = [];
    queryString.push('cacheEnable=true');
    if (options.refresh) {
      queryString.push('overrideCache=true');
    }
    return `?${queryString.join('&')}`;
  }
}
