import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface AccessReview {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  createdBy?: string | null;
  completedBy?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  dueAt?: Date | string | null;
  notes?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IAccessReviewRepository extends IBasicRepository<AccessReview> {}

export class AccessReviewRepository
  extends BaseRepository<AccessReview>
  implements IAccessReviewRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'access_review' });
  }
}
