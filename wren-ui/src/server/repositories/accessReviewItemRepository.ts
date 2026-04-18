import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface AccessReviewItem {
  id: string;
  accessReviewId: string;
  workspaceId: string;
  workspaceMemberId?: string | null;
  userId?: string | null;
  roleKey?: string | null;
  status: string;
  decision?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | string | null;
  notes?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IAccessReviewItemRepository
  extends IBasicRepository<AccessReviewItem> {}

export class AccessReviewItemRepository
  extends BaseRepository<AccessReviewItem>
  implements IAccessReviewItemRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'access_review_item' });
  }
}
