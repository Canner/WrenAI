import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface Instruction {
  id: number;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  instruction: string;
  questions: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InstructionRuntimeScope = Pick<
  Instruction,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface IInstructionRepository extends IBasicRepository<Instruction> {
  findAllByRuntimeIdentity(
    runtimeIdentity: InstructionRuntimeScope,
  ): Promise<Instruction[]>;
  findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: InstructionRuntimeScope,
  ): Promise<Instruction | null>;
}

export class InstructionRepository
  extends BaseRepository<Instruction>
  implements IInstructionRepository
{
  private readonly jsonbColumns = ['questions'];
  private readonly canonicalScopeFields: (keyof InstructionRuntimeScope)[] = [
    'workspaceId',
    'knowledgeBaseId',
    'kbSnapshotId',
    'deployHash',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'instruction' });
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: InstructionRuntimeScope,
  ): Promise<Instruction[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity);
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: InstructionRuntimeScope,
  ): Promise<Instruction | null> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).where({ id });
    const row = await query.first();
    return row ? this.transformFromDBData(row) : null;
  }

  private buildRuntimeScopedQuery(scope: InstructionRuntimeScope) {
    const query = this.knex(this.tableName);

    this.applyBridgeScopeField(
      query,
      scope.projectId,
      this.hasCanonicalRuntimeScope(scope),
    );
    this.applyScopeField(query, 'workspaceId', scope.workspaceId);
    this.applyScopeField(query, 'knowledgeBaseId', scope.knowledgeBaseId);
    this.applyScopeField(query, 'kbSnapshotId', scope.kbSnapshotId);
    this.applyScopeField(query, 'deployHash', scope.deployHash);

    return query;
  }

  private hasCanonicalRuntimeScope(scope: InstructionRuntimeScope) {
    return this.canonicalScopeFields.some((field) => scope[field] != null);
  }

  private applyBridgeScopeField(
    query: Knex.QueryBuilder,
    bridgeProjectId?: number | null,
    hasCanonicalScope = false,
  ) {
    if (hasCanonicalScope) {
      return;
    }

    if (bridgeProjectId == null) {
      query.whereNull('project_id');
      return;
    }

    query.andWhere('project_id', bridgeProjectId);
  }

  private applyScopeField(
    query: Knex.QueryBuilder,
    field: Exclude<keyof InstructionRuntimeScope, 'projectId'>,
    value?: string | null,
  ) {
    const column = snakeCase(field);
    if (value == null) {
      query.whereNull(column);
      return;
    }

    query.andWhere(column, value);
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    });
    return transformData as Instruction;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
