import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface AuditEvent {
  id: string;
  workspaceId?: string | null;
  scopeType?: string | null;
  scopeId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorUserId?: string | null;
  action?: string | null;
  entityType: string;
  entityId: string;
  resourceType?: string | null;
  resourceId?: string | null;
  eventType: string;
  result?: string | null;
  reason?: string | null;
  beforeJson?: Record<string, any> | null;
  afterJson?: Record<string, any> | null;
  payloadJson?: Record<string, any> | null;
  requestId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface AuditEventSearchInput {
  workspaceId?: string | null;
  scopeType?: string;
  scopeId?: string;
  actorType?: string;
  actorId?: string;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  query?: string;
  limit?: number;
}

export interface IAuditEventRepository extends IBasicRepository<AuditEvent> {
  search(input: AuditEventSearchInput): Promise<AuditEvent[]>;
}

export class AuditEventRepository
  extends BaseRepository<AuditEvent>
  implements IAuditEventRepository
{
  private readonly jsonColumns = ['beforeJson', 'afterJson', 'payloadJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'audit_event' });
  }

  protected override transformFromDBData = (data: any): AuditEvent => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value === 'string') {
        return value ? JSON.parse(value) : value;
      }
      return value;
    });

    return transformedData as AuditEvent;
  };

  protected override transformToDBData = (data: Partial<AuditEvent>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value !== 'string') {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  public async search(input: AuditEventSearchInput) {
    const limit = Math.min(Math.max(input.limit || 50, 1), 200);
    const query = this.knex(this.tableName)
      .modify((builder) => {
        if (input.workspaceId) {
          builder.where('workspace_id', input.workspaceId);
        }
        if (input.scopeType) {
          builder.where('scope_type', input.scopeType);
        }
        if (input.scopeId) {
          builder.where('scope_id', input.scopeId);
        }
        if (input.actorType) {
          builder.where('actor_type', input.actorType);
        }
        if (input.actorId) {
          builder.where('actor_id', input.actorId);
        }
        if (input.actorUserId) {
          builder.where('actor_user_id', input.actorUserId);
        }
        if (input.action) {
          builder.where('action', input.action);
        }
        if (input.resourceType) {
          builder.where('resource_type', input.resourceType);
        }
        if (input.resourceId) {
          builder.where('resource_id', input.resourceId);
        }
        if (input.entityType) {
          builder.where('entity_type', input.entityType);
        }
        if (input.entityId) {
          builder.where('entity_id', input.entityId);
        }
        if (input.result) {
          builder.where('result', input.result);
        }
        if (input.query) {
          const keyword = `%${input.query.trim()}%`;
          builder.andWhere((nested) => {
            nested
              .whereILike('action', keyword)
              .orWhereILike('entity_type', keyword)
              .orWhereILike('entity_id', keyword)
              .orWhereILike('resource_type', keyword)
              .orWhereILike('resource_id', keyword)
              .orWhereILike('reason', keyword)
              .orWhereILike('actor_type', keyword)
              .orWhereILike('actor_id', keyword)
              .orWhereILike('event_type', keyword);
          });
        }
      })
      .orderBy('created_at', 'desc')
      .limit(limit);

    const rows = await query;
    return rows.map(this.transformFromDBData);
  }
}
