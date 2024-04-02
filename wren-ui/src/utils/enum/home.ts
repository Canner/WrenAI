export enum COLLAPSE_CONTENT_TYPE {
  NONE = 'none',
  VIEW_SQL = 'view_sql',
  PREVIEW_DATA = 'preview_data',
}

export enum PROCESS_STATE {
  IDLE,
  UNDERSTANDING,
  SEARCHING,
  GENERATING,
  FINISHED,

  FAILED,
  NO_RESULT,
}
