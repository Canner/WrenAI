import { gql } from '@apollo/client';

export const COMMON_DASHBOARD_ITEM = gql`
  fragment CommonDashboardItem on DashboardItem {
    id
    dashboardId
    type
    layout {
      x
      y
      w
      h
    }
    detail {
      sql
      chartSchema
    }
  }
`;

export const DASHBOARD_ITEMS = gql`
  query DashboardItems {
    dashboardItems {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const CREATE_DASHBOARD_ITEM = gql`
  mutation CreateDashboardItem($data: CreateDashboardItemInput!) {
    createDashboardItem(data: $data) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const UPDATE_DASHBOARD_ITEM_LAYOUTS = gql`
  mutation UpdateDashboardItemLayouts($data: UpdateDashboardItemLayoutsInput!) {
    updateDashboardItemLayouts(data: $data) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const DELETE_DASHBOARD_ITEM = gql`
  mutation DeleteDashboardItem($where: DashboardItemWhereInput!) {
    deleteDashboardItem(where: $where)
  }
`;

export const PREVIEW_ITEM_SQL = gql`
  mutation PreviewItemSQL($data: PreviewItemSQLInput!) {
    previewItemSQL(data: $data)
  }
`;
