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
  workspaceId: string;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  payloadJson?: Record<string, any> | null;
}

export interface IAuditEventRepository extends IBasicRepository<AuditEvent> {}

export class AuditEventRepository
  extends BaseRepository<AuditEvent>
  implements IAuditEventRepository
{
  private readonly jsonColumns = ['payloadJson'];

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
}
