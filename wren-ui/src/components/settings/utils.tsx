import { SETTINGS } from '@/utils/enum';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';

export const getSettingMenu = (menu: SETTINGS) =>
  ({
    [SETTINGS.CONNECTION]: {
      icon: DatabaseOutlined,
      label: '连接设置',
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: '知识库设置',
    },
  })[menu] || null;
