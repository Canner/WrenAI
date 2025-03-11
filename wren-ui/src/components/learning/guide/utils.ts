import { Driver, Config, Popover, PopoverDOM } from 'driver.js';

export type DriverPopover = Popover;
export type DriverObj = Driver;
export type DriverPopoverDOM = PopoverDOM;
export type DriverConfig = Config;
export type Dispatcher = {
  onDone?: () => Promise<void>;
  onSaveLanguage?: (value: string) => Promise<void>;
};

// NOTE: Don't change the enum values, it's used in save to db
export enum LEARNING {
  // modeling
  DATA_MODELING_GUIDE = 'DATA_MODELING_GUIDE',
  CREATING_MODEL = 'CREATING_MODEL',
  CREATING_VIEW = 'CREATING_VIEW',
  WORKING_RELATIONSHIP = 'WORKING_RELATIONSHIP',
  CONNECT_OTHER_DATA_SOURCES = 'CONNECT_OTHER_DATA_SOURCES',

  // home
  SWITCH_PROJECT_LANGUAGE = 'SWITCH_PROJECT_LANGUAGE',
  SHARE_RESULTS = 'SHARE_RESULTS',
  VIEW_FULL_SQL = 'VIEW_FULL_SQL',

  // knowledge
  QUESTION_SQL_PAIRS_GUIDE = 'QUESTION_SQL_PAIRS_GUIDE',
  SAVE_TO_KNOWLEDGE = 'SAVE_TO_KNOWLEDGE',
}
