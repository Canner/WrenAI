import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { ExplainPipelineStatus, WrenAIError } from '../adaptors/wrenAIAdaptor';

export interface DetailStep {
  summary: string;
  sql: string;
  cteName: string;
}

export enum ExplainType {
  FILTER = 'filter',
  GROUP_BY_KEY = 'groupByKeys',
  RELATION = 'relation',
  SELECT_ITEMS = 'selectItems',
  SORTINGS = 'sortings',
}

export interface ExprSource {
  expression: string;
  sourceDataset: string;
}

export interface FilterPayload {
  id?: string;
  expression: string;
  explanation: string;
}

export interface GroupByPayload {
  id?: string;
  expression: string;
  explanation: string;
}

export interface RelationPayload {
  id?: string;
  type: string;
  criteria?: string;
  exprSources?: ExprSource[];
  tableName?: string;
  explanation?: string;
}
export interface SelectItemsPayload {
  id?: string;
  alias: string;
  expression: string;
  isFunctionCallOrMathematicalOperation: boolean;
  explanation: string;
}
export interface SortingPayload {
  id?: string;
  expression: string;
  explanation: string;
}

export type ExplainPayload =
  | FilterPayload
  | GroupByPayload
  | RelationPayload
  | SelectItemsPayload
  | SortingPayload;

export interface ExplainDetail {
  type: ExplainType;
  payload: ExplainPayload;
}

export interface ThreadResponseExplain {
  id: number; // ID
  threadResponseId: number; // Reference to thread_response.id
  queryId: string; // explain pipeline query ID
  status: ExplainPipelineStatus; // explain pipeline status
  detail: ExplainDetail; // explain detail
  error: object; // explain error
}

export interface IThreadResponseExplainRepository
  extends IBasicRepository<ThreadResponseExplain> {}

export class ThreadResponseExplainRepository
  extends BaseRepository<ThreadResponseExplain>
  implements IThreadResponseExplainRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response_explain' });
  }

  public async updateOne(
    id: number,
    data: Partial<{
      status: ExplainPipelineStatus;
      detail: ExplainDetail;
      error: WrenAIError;
    }>,
    queryOptions?: IQueryOptions,
  ) {
    const transformedData = {
      ...data,
      detail: data.detail ? JSON.stringify(data.detail) : null,
      error: data.error ? JSON.stringify(data.error) : null,
    };
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .where({ id })
      .update(transformedData)
      .returning('*');
    return this.transformFromDBData(result);
  }

  protected override transformFromDBData = (
    data: any,
  ): ThreadResponseExplain => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['error', 'detail'].includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ThreadResponseExplain;
    return formattedData;
  };
}
