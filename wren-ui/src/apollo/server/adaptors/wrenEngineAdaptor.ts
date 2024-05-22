import axios from 'axios';
import { Manifest } from '../mdl/type';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';

const logger = getLogger('WrenEngineAdaptor');
logger.level = 'debug';

const DEFAULT_PREVIEW_LIMIT = 500;

export enum WrenEngineDeployStatusEnum {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface WrenEngineDeployStatusResponse {
  systemStatus: string;
  version: string;
}

export interface DeployResponse {
  status: WrenEngineDeployStatusEnum;
  error?: string;
}

interface DeployPayload {
  manifest: Manifest;
  version: string;
}

export interface deployData {
  manifest: Manifest;
  hash: string;
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

export interface ValidationResponse {
  valid: boolean;
  message?: string;
}

export interface DryPlanOption {
  modelingOnly?: boolean;
  manifest?: Manifest;
}

export interface IWrenEngineAdaptor {
  deploy(deployData: deployData): Promise<DeployResponse>;
  initDatabase(sql: string): Promise<void>;
  putSessionProps(props: Record<string, any>): Promise<void>;
  queryDuckdb(sql: string): Promise<EngineQueryResponse>;
  patchConfig(config: Record<string, any>): Promise<void>;
  previewData(
    sql: string,
    limit?: number,
    mdl?: Manifest,
  ): Promise<EngineQueryResponse>;
  describeStatement(sql: string): Promise<DescribeStatementResponse>;
  getNativeSQL(sql: string, options?: DryPlanOption): Promise<string>;
  validateColumnIsValid(
    manifest: Manifest,
    modelName: string,
    columnName: string,
  ): Promise<ValidationResponse>;
}

export class WrenEngineAdaptor implements IWrenEngineAdaptor {
  private readonly wrenEngineBaseEndpoint: string;
  private sessionPropsUrlPath = '/v1/data-source/duckdb/settings/session-sql';
  private queryDuckdbUrlPath = '/v1/data-source/duckdb/query';
  private initSqlUrlPath = '/v1/data-source/duckdb/settings/init-sql';
  private previewUrlPath = '/v1/mdl/preview';
  private dryPlanUrlPath = '/v1/mdl/dry-plan';
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

  public async deploy(deployData: deployData): Promise<DeployResponse> {
    const { manifest, hash } = deployData;
    const deployPayload = { manifest, version: hash } as DeployPayload;

    try {
      // skip if the model has been deployed
      const resp = await this.getDeployStatus();
      if (resp.version === hash) {
        return { status: WrenEngineDeployStatusEnum.SUCCESS };
      }

      // start deploy to wren engine
      await axios.post(
        `${this.wrenEngineBaseEndpoint}/v1/mdl/deploy`,
        deployPayload,
      );
      logger.debug(`WrenEngine: Deploy wren engine success, hash: ${hash}`);
      return { status: WrenEngineDeployStatusEnum.SUCCESS };
    } catch (err: any) {
      logger.debug(`Got error when deploying to wren engine: ${err.message}`);
      return {
        status: WrenEngineDeployStatusEnum.FAILED,
        error: `WrenEngine Error, deployment hash:${hash}: ${err.message}`,
      };
    }
  }

  public async initDatabase(sql) {
    try {
      const url = new URL(this.initSqlUrlPath, this.wrenEngineBaseEndpoint);
      logger.debug(`Endpoint: ${url.href}`);
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
      logger.debug(`Endpoint: ${url.href}`);
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
    limit: number = DEFAULT_PREVIEW_LIMIT,
    manifest?: Manifest,
  ): Promise<EngineQueryResponse> {
    try {
      const url = new URL(this.previewUrlPath, this.wrenEngineBaseEndpoint);
      const headers = {
        'Content-Type': 'application/json',
      };

      const res = await axios({
        method: 'get',
        url: url.href,
        headers,
        data: {
          sql,
          limit,
          manifest,
        },
      });

      return res.data as EngineQueryResponse;
    } catch (err: any) {
      logger.debug(`Got error when previewing data: ${err.message}`);
      throw err;
    }
  }

  public async describeStatement(
    sql: string,
  ): Promise<DescribeStatementResponse> {
    try {
      // preview data with limit 1 to get column metadata
      const res = await this.previewData(sql, 1);
      return { columns: res.columns };
    } catch (err: any) {
      logger.debug(`Got error when describing statement: ${err.message}`);
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

      const res = await axios({
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
      throw err;
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
}
