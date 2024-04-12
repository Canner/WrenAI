import { SETTINGS } from '@/utils/enum';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';

export const getSettingMenu = (menu: SETTINGS) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseOutlined,
      label: 'Data Source Settings',
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: 'Project Settings',
    },
  })[menu] || null;
