import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Relation {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // Relation name
  joinType: string; // Join type, eg:"MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"
  condition: string; // Join condition, ex: "OrdersModel.custkey = CustomerModel.custkey"
  leftColumnId: number; // Left column id, "{leftSideColumn} {joinType} {rightSideColumn}"
  rightColumnId: number; // Right column id, "{leftSideColumn} {joinType} {rightSideColumn}"
}

export interface IRelationRepository extends IBasicRepository<Relation> {}

export class RelationRepository extends BaseRepository<Relation> {
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'relation' });
  }
}
