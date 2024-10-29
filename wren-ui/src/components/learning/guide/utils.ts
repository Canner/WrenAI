import { Driver, Popover, PopoverDOM } from 'driver.js';

export type DriverPopover = Popover;
export type DriverObj = Driver;
export type DriverPopoverDOM = PopoverDOM;

// NOTE: Don't change the enum values, it's used in save to db
export enum LEARNING {
  DATA_MODELING_GUIDE = 'DATA_MODELING_GUIDE',
  CREATING_MODEL = 'CREATING_MODEL',
  CREATING_VIEW = 'CREATING_VIEW',
  WORKING_RELATIONSHIP = 'WORKING_RELATIONSHIP',
  CONNECT_OTHER_DATA_SOURCES = 'CONNECT_OTHER_DATA_SOURCES',
}
