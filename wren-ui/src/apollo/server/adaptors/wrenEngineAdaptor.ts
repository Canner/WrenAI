import axios, { AxiosResponse } from 'axios';
import { Manifest } from '../mdl/type';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import { CompactTable, DEFAULT_PREVIEW_LIMIT } from '../services';

const logger = getLogger('WrenEngineAdaptor');
logger.level = 'debug';

export interface WrenEngineDeployStatusResponse {
  systemStatus: string;
  version: string;
}

export interface ColumnMetadata {
  name: string;
  type: string;
}

export interface EngineQueryResponse {
  columns: ColumnMetadata[];
  data: any[][];
}

export interface DescribeStatementResponse {
  columns: ColumnMetadata[];
}

export enum WrenEngineValidateStatus {
  PASS = 'PASS',
  ERROR = 'ERROR',
  FAIL = 'FAIL',
  WARN = 'WARN',
  SKIP = 'SKIP',
}

export interface WrenEngineValidateResponse {
  duration: string;
  name: string;
  status: WrenEngineValidateStatus;
}

export interface WrenEngineValidationResponse {
  valid: boolean;
  message?: string;
}

export interface DryPlanOption {
  modelingOnly?: boolean;
  manifest?: Manifest;
}

export interface WrenEngineDryRunOption {
  manifest?: Manifest;
  limit?: number;
}

export interface DuckDBPrepareOptions {
  initSql: string;
  sessionProps: Record<string, any>;
}

// The response consists of an array containing columns. Each column contains a name and a type.
export interface WrenEngineDryRunResponse {
  name: string;
  type: string;
}

export interface IWrenEngineAdaptor {
  // duckdb data source related
  prepareDuckDB(options: DuckDBPrepareOptions): Promise<void>;
  queryDuckdb(sql: string): Promise<EngineQueryResponse>;
  putSessionProps(props: Record<string, any>): Promise<void>;

  // metadata related, used to fetch metadata of duckdb
  listTables(): Promise<CompactTable[]>;

  // config wren engine
  patchConfig(config: Record<string, any>): Promise<void>;

  // query
  previewData(
    sql: string,
    mdl: Manifest,
    limit?: number,
  ): Promise<EngineQueryResponse>;
  getNativeSQL(sql: string, options?: DryPlanOption): Promise<string>;
  validateColumnIsValid(
    manifest: Manifest,
    modelName: string,
    columnName: string,
  ): Promise<WrenEngineValidationResponse>;
  dryRun(
    sql: string,
    options: WrenEngineDryRunOption,
  ): Promise<WrenEngineDryRunResponse[]>;
}

export class WrenEngineAdaptor implements IWrenEngineAdaptor {
  private readonly wrenEngineBaseEndpoint: string;
  private sessionPropsUrlPath = '/v1/data-source/duckdb/settings/session-sql';
  private queryDuckdbUrlPath = '/v1/data-source/duckdb/query';
  private initSqlUrlPath = '/v1/data-source/duckdb/settings/init-sql';
  private previewUrlPath = '/v1/mdl/preview';
  private dryPlanUrlPath = '/v1/mdl/dry-plan';
  private dryRunUrlPath = '/v1/mdl/dry-run';
  private validateUrlPath = '/v1/mdl/validate';

  constructor({ wrenEngineEndpoint }: { wrenEngineEndpoint: string }) {
    this.wrenEngineBaseEndpoint = wrenEngineEndpoint;
  }

  public async validateColumnIsValid(
    manifest: Manifest,
    modelName: string,
    columnName: string,
  ) {
    const model = manifest.models.find((m) => m.name === modelName);
    if (!model) {
      return {
        valid: false,
        message: `Model ${modelName} not found in the manifest`,
      };
    }
    const column = model.columns.find((c) => c.name === columnName);
    if (!column) {
      return {
        valid: false,
        message: `Column ${columnName} not found in model ${modelName} in the manifest`,
      };
    }
    try {
      const payload = {
        manifest,
        parameters: { modelName, columnName },
      };
      const res = await axios.post(
        `${this.wrenEngineBaseEndpoint}${this.validateUrlPath}/column_is_valid`,
        payload,
      );
      const result = res.data[0] as WrenEngineValidateResponse;
      if (result.status === WrenEngineValidateStatus.PASS) {
        return { valid: true };
      } else {
        return { valid: false, message: JSON.stringify(result) };
      }
    } catch (err: any) {
      logger.debug(`Got error when validating column: ${err.message}`);
      return { valid: false, message: err.message };
    }
  }

  public async prepareDuckDB(options: DuckDBPrepareOptions): Promise<void> {
    const { initSql, sessionProps } = options;
    await this.initDatabase(initSql);
    await this.putSessionProps(sessionProps);
  }

  public async listTables() {
    const sql =
      'SELECT \
      table_catalog, table_schema, table_name, column_name, ordinal_position, is_nullable, data_type\
      FROM INFORMATION_SCHEMA.COLUMNS;';
    const response = await this.queryDuckdb(sql);
    return this.formatToCompactTable(response);
  }

  public async putSessionProps(props: Record<string, any>) {
    const setSessionStatements = Object.entries(props)
      .map(([key, value]) => {
        return `SET ${key} = '${value}';`;
      })
      .join('\n');
    try {
      const url = new URL(
        this.sessionPropsUrlPath,
        this.wrenEngineBaseEndpoint,
      );
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
      };
      await axios.put(url.href, setSessionStatements, { headers });
    } catch (err: any) {
      logger.debug(`Got error when put session props: ${err.message}`);
      throw Errors.create(Errors.GeneralErrorCodes.SESSION_PROPS_ERROR, {
        customMessage:
          Errors.errorMessages[Errors.GeneralErrorCodes.SESSION_PROPS_ERROR],
        originalError: err,
      });
    }
  }

  public async queryDuckdb(sql: string): Promise<EngineQueryResponse> {
    try {
      const url = new URL(this.queryDuckdbUrlPath, this.wrenEngineBaseEndpoint);
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
      };
      const res = await axios.post(url.href, sql, { headers });
      return res.data as EngineQueryResponse;
    } catch (err: any) {
      logger.debug(`Got error when querying duckdb: ${err.message}`);
      throw err;
    }
  }

  public async patchConfig(config: Record<string, any>) {
    try {
      const configPayload = Object.entries(config).map(([key, value]) => {
        return {
          name: key,
          value,
        };
      });
      const url = new URL('/v1/config', this.wrenEngineBaseEndpoint);
      const headers = {
        'Content-Type': 'application/json',
      };
      await axios.patch(url.href, configPayload, { headers });
    } catch (err: any) {
      logger.debug(`Got error when patching config: ${err.message}`);
      throw err;
    }
  }

  public async previewData(
    sql: string,
    manifest: Manifest,
    limit: number = DEFAULT_PREVIEW_LIMIT,
  ): Promise<EngineQueryResponse> {
    try {
      const url = new URL(this.previewUrlPath, this.wrenEngineBaseEndpoint);
      const headers = {
        'Content-Type': 'application/json',
      };

      const res: AxiosResponse<EngineQueryResponse> = await axios({
        method: 'get',
        url: url.href,
        headers,
        data: {
          sql,
          limit,
          manifest,
        },
      });

      return res.data;
    } catch (err: any) {
      logger.debug(`Got error when previewing data: ${err.message}`);
      throw err;
    }
  }

  public async getNativeSQL(
    sql: string,
    options: DryPlanOption,
  ): Promise<string> {
    try {
      const props = {
        modelingOnly: options?.modelingOnly ? true : false,
        manifest: options?.manifest,
      };

      const url = new URL(this.dryPlanUrlPath, this.wrenEngineBaseEndpoint);
      const headers = { 'Content-Type': 'application/json' };

      const res: AxiosResponse<string> = await axios({
        method: 'get',
        url: url.href,
        headers,
        data: {
          sql,
          ...props,
        },
      });

      return res.data;
    } catch (err: any) {
      logger.debug(`Got error when getting native SQL: ${err.message}`);
      Errors.create(Errors.GeneralErrorCodes.DRY_PLAN_ERROR, {
        customMessage: err.message,
        originalError: err,
      });
    }
  }

  public async dryRun(
    sql: string,
    options: WrenEngineDryRunOption,
  ): Promise<WrenEngineDryRunResponse[]> {
    try {
      const { manifest } = options;
      const body = {
        sql,
        manifest,
      };
      logger.debug(
        `Dry run wren engine with body: ${JSON.stringify(sql, null, 2)}`,
      );
      const url = new URL(this.dryRunUrlPath, this.wrenEngineBaseEndpoint);
      const res: AxiosResponse<WrenEngineDryRunResponse[]> = await axios({
        method: 'get',
        url: url.href,
        data: body,
      });
      logger.debug(`Wren Engine Dry run success`);
      return res.data;
    } catch (err: any) {
      logger.info(`Got error when dry running`);
      throw Errors.create(Errors.GeneralErrorCodes.DRY_RUN_ERROR, {
        customMessage: err.response.data.message,
        originalError: err,
      });
    }
  }

  private async getDeployStatus(): Promise<WrenEngineDeployStatusResponse> {
    try {
      const res = await axios.get(
        `${this.wrenEngineBaseEndpoint}/v1/mdl/status`,
      );
      return res.data as WrenEngineDeployStatusResponse;
    } catch (err: any) {
      logger.debug(
        `WrenEngine: Got error when getting deploy status: ${err.message}`,
      );
      throw err;
    }
  }

  private async initDatabase(sql) {
    try {
      const url = new URL(this.initSqlUrlPath, this.wrenEngineBaseEndpoint);
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
      };
      await axios.put(url.href, sql, { headers });
    } catch (err: any) {
      logger.debug(`Got error when init database: ${err}`);
      throw Errors.create(Errors.GeneralErrorCodes.INIT_SQL_ERROR, {
        customMessage:
          Errors.errorMessages[Errors.GeneralErrorCodes.INIT_SQL_ERROR],
        originalError: err,
      });
    }
  }

  private formatToCompactTable(columns: EngineQueryResponse): CompactTable[] {
    return columns.data.reduce((acc: CompactTable[], row: any) => {
      const [
        table_catalog,
        table_schema,
        table_name,
        column_name,
        _ordinal_position,
        is_nullable,
        data_type,
      ] = row;
      let table = acc.find(
        (t) => t.name === table_name && t.properties.schema === table_schema,
      );
      if (!table) {
        table = {
          name: table_name,
          description: '',
          columns: [],
          properties: {
            schema: table_schema,
            catalog: table_catalog,
            table: table_name,
          },
          primaryKey: null,
        };
        acc.push(table);
      }
      table.columns.push({
        name: column_name,
        type: data_type,
        notNull: is_nullable.toLocaleLowerCase() !== 'yes',
        description: '',
        properties: {},
      });
      return acc;
    }, []);
  }
}
