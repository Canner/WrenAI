import { SETTINGS } from '@/utils/enum';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';
import { LightningIcon } from '@/utils/icons';

export const getSettingMenu = (menu: SETTINGS) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseOutlined,
      label: 'Data Source Settings',
    },
    [SETTINGS.CACHE]: {
      icon: ({ className = undefined }) => (
        <span role="img" className={`anticon ${className || ''}`}>
          <LightningIcon />
        </span>
      ),
      label: 'Cache Settings',
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: 'Project Settings',
    },
  })[menu] || null;
