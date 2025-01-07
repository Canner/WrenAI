export {
  NodeType as NODE_TYPE,
  RelationType as JOIN_TYPE,
} from '@/apollo/client/graphql/__types__';

export enum MORE_ACTION {
  EDIT = 'edit',
  DELETE = 'delete',
  UPDATE_COLUMNS = 'update_columns',
  REFRESH = 'refresh',
  HIDE_CATEGORY = 'hide_category',
}
