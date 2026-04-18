import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface DirectoryGroupMember {
  id: string;
  directoryGroupId: string;
  workspaceId: string;
  userId: string;
  source: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IDirectoryGroupMemberRepository
  extends IBasicRepository<DirectoryGroupMember> {
  findAllByUser(
    workspaceId: string,
    userId: string,
    queryOptions?: IQueryOptions,
  ): Promise<DirectoryGroupMember[]>;
  deleteByGroupId(
    directoryGroupId: string,
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

export class DirectoryGroupMemberRepository
  extends BaseRepository<DirectoryGroupMember>
  implements IDirectoryGroupMemberRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'directory_group_member' });
  }

  public async findAllByUser(
    workspaceId: string,
    userId: string,
    queryOptions?: IQueryOptions,
  ) {
    return await this.findAllBy({ workspaceId, userId }, queryOptions);
  }

  public async deleteByGroupId(
    directoryGroupId: string,
    queryOptions?: IQueryOptions,
  ) {
    return await this.deleteAllBy({ directoryGroupId }, queryOptions);
  }
}
