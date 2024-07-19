import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { ExplainPipelineStatus } from '../adaptors/wrenAIAdaptor';

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
  id?: number;
  expression: string;
  explanation: string;
}

export interface GroupByPayload {
  id?: number;
  expression: string;
  explanation: string;
}

export interface RelationPayload {
  id?: number;
  type: string;
  criteria?: string;
  exprSources?: ExprSource[];
  tableName?: string;
  explanation?: string;
}
export interface SelectItemsPayload {
  id?: number;
  alias: string;
  expression: string;
  isFunctionCallOrMathematicalOperation: boolean;
  explanation: string;
}
export interface SortingPayload {
  id?: number;
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
  detail: ExplainDetail[]; // explain detail
  error: object; // explain error
  analysis: object; // analysis result
}

export interface IThreadResponseExplainRepository
  extends IBasicRepository<ThreadResponseExplain> {
  findAllByThread(threadId: number): Promise<ThreadResponseExplain[]>;
}

export class ThreadResponseExplainRepository
  extends BaseRepository<ThreadResponseExplain>
  implements IThreadResponseExplainRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response_explain' });
  }
  public async findAllByThread(
    threadId: number,
  ): Promise<ThreadResponseExplain[]> {
    return this.knex('thread_response as tr')
      .join(
        this.knex(this.tableName)
          .distinctOn('thread_response_id')
          .select('id', 'thread_response_id', 'detail', 'error', 'created_at')
          .orderBy([
            'thread_response_id',
            { column: 'created_at', order: 'desc' },
          ])
          .as('tre'),
        'tre.thread_response_id',
        'tr.id',
      )
      .select('*')
      .where('tr.thread_id', threadId)
      .then((results) => results.map(this.transformFromDBData));
  }

  public async createOne(
    data: Partial<ThreadResponseExplain>,
    queryOptions?: IQueryOptions,
  ) {
    const transformedData = {
      ...data,
      detail: data.detail ? JSON.stringify(data.detail) : null,
      error: data.error ? JSON.stringify(data.error) : null,
      analysis: data.analysis ? JSON.stringify(data.analysis) : null,
    } as any;
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .insert(this.transformToDBData(transformedData))
      .returning('*');
    return this.transformFromDBData(result);
  }

  public async updateOne(
    id: number,
    data: Partial<ThreadResponseExplain>,
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
      if (['error', 'detail', 'analysis'].includes(key)) {
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
