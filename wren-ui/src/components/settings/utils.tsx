import { SETTINGS } from '@/utils/enum';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';

export const getSettingMenu = (menu: SETTINGS) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseOutlined,
      label: 'Data source settings',
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: 'Project settings',
    },
  })[menu] || null;
