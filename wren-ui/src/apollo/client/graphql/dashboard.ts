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
    displayName
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

export const UPDATE_DASHBOARD_ITEM = gql`
  mutation UpdateDashboardItem(
    $where: DashboardItemWhereInput!
    $data: UpdateDashboardItemInput!
  ) {
    updateDashboardItem(where: $where, data: $data) {
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
    previewItemSQL(data: $data) {
      data
      cacheHit
      cacheCreatedAt
      cacheOverrodeAt
      override
    }
  }
`;

export const SET_DASHBOARD_SCHEDULE = gql`
  mutation SetDashboardSchedule(
    $where: DashboardWhereInput!
    $data: SetDashboardScheduleInput!
  ) {
    setDashboardSchedule(where: $where, data: $data) {
      id
      projectId
      name
      cacheEnabled
      scheduleFrequency
      scheduleTimezone
      scheduleCron
      nextScheduledAt
    }
  }
`;

export const DASHBOARDS = gql`
  query Dashboards {
    dashboards {
      id
      projectId
      name
    }
  }
`;

export const DASHBOARD = gql`
  query Dashboard($where: DashboardWhereInput) {
    dashboard(where: $where) {
      id
      name
      description
      cacheEnabled
      nextScheduledAt
      schedule {
        frequency
        hour
        minute
        day
        timezone
        cron
      }
      items {
        ...CommonDashboardItem
      }
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const CREATE_DASHBOARD = gql`
  mutation CreateDashboard($data: CreateDashboardInput) {
    createDashboard(data: $data) {
      id
      projectId
      name
      cacheEnabled
      scheduleFrequency
      scheduleTimezone
      scheduleCron
      nextScheduledAt
    }
  }
`;

export const UPDATE_DASHBOARD = gql`
  mutation UpdateDashboard(
    $where: DashboardWhereInput!
    $data: UpdateDashboardInput!
  ) {
    updateDashboard(where: $where, data: $data) {
      id
      projectId
      name
      cacheEnabled
      scheduleFrequency
      scheduleTimezone
      scheduleCron
      nextScheduledAt
    }
  }
`;

export const DELETE_DASHBOARD = gql`
  mutation DeleteDashboard($where: DashboardWhereInput!) {
    deleteDashboard(where: $where) {
      id
      projectId
      name
    }
  }
`;
