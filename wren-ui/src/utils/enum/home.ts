export enum COLLAPSE_CONTENT_TYPE {
  NONE = 'none',
  VIEW_SQL = 'view_sql',
  PREVIEW_DATA = 'preview_data',
}

export enum PROCESS_STATE {
  IDLE,
  UNDERSTANDING,
  SEARCHING,
  PLANNING,
  GENERATING,
  FINISHED,
  FAILED,
  NO_RESULT,
}

export enum ANSWER_TAB_KEYS {
  ANSWER = 'answer',
  VIEW_SQL = 'view-sql',
  CHART = 'chart',
}
