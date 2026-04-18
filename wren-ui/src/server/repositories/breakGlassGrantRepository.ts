import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface BreakGlassGrant {
  id: string;
  workspaceId: string;
  userId: string;
  roleKey: string;
  status: string;
  reason: string;
  expiresAt: Date | string;
  revokedAt?: Date | string | null;
  createdBy?: string | null;
  revokedBy?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IBreakGlassGrantRepository
  extends IBasicRepository<BreakGlassGrant> {
  findActiveGrantForUser(
    workspaceId: string,
    userId: string,
    queryOptions?: IQueryOptions,
  ): Promise<BreakGlassGrant | null>;
}

export class BreakGlassGrantRepository
  extends BaseRepository<BreakGlassGrant>
  implements IBreakGlassGrantRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'break_glass_grant' });
  }

  public async findActiveGrantForUser(
    workspaceId: string,
    userId: string,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const row = await executer(this.tableName)
      .where({ workspace_id: workspaceId, user_id: userId, status: 'active' })
      .whereNull('revoked_at')
      .where('expires_at', '>', new Date())
      .orderBy('expires_at', 'desc')
      .first();

    return row ? this.transformFromDBData(row) : null;
  }
}
