import { SampleDatasetName, DataSourceName } from '@/types/dataSource';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Layout, Button, message } from 'antd';
import styled from 'styled-components';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { SETTINGS } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import { ModalAction } from '@/hooks/useModalAction';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import ConnectionSettings from './ConnectionSettings';
import ProjectSettings from './ProjectSettings';
import { getSettingMenu } from './utils';
import {
  fetchSettings,
  resolveSettingsConnection,
  type SettingsData,
} from '@/utils/settingsRest';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

const { Sider, Content } = Layout;

type Props = ModalAction<any, any> & {
  loading?: boolean;
};

const StyledSider = styled(Sider)`
  .ant-layout-sider-children {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
`;

const StyledModal = styled(Modal)`
  .ant-modal-content {
    overflow: hidden;
  }
  .ant-modal-close-x {
    width: 48px;
    height: 48px;
    line-height: 48px;
  }
`;

const StyledButton = styled(Button)`
  display: flex;
  align-items: center;
  padding: 12px 8px;
  margin-bottom: 4px;
`;

const DynamicComponent = ({
  menu,
  data,
  refetch,
  closeModal,
}: {
  menu: SETTINGS;
  data?: SettingsData | null;
  refetch: () => Promise<SettingsData | null>;
  closeModal: () => void;
}) => {
  if (!data) {
    return null;
  }

  const connection = resolveSettingsConnection(data);
  const { language } = data || {};
  return (
    {
      [SETTINGS.CONNECTION]: (
        <ConnectionSettings
          type={connection?.type as DataSourceName}
          sampleDataset={
            (connection?.sampleDataset || null) as SampleDatasetName
          }
          properties={connection?.properties || {}}
          refetchSettings={refetch}
          closeModal={closeModal}
        />
      ),
      [SETTINGS.PROJECT]: (
        <ProjectSettings
          data={{ language: String(language || '') }}
          refetchSettings={refetch}
        />
      ),
    }[menu] || null
  );
};

type MenuTemplateProps = {
  currentMenu: SETTINGS;
  value: SETTINGS;
  onClick: (payload: { value: SETTINGS }) => void;
};

const MenuTemplate = ({ currentMenu, value, onClick }: MenuTemplateProps) => {
  const current = getSettingMenu(value);
  return (
    <StyledButton
      className={currentMenu === value ? 'geekblue-6 bg-gray-4' : 'gray-8'}
      type="text"
      block
      onClick={() => onClick({ value })}
      icon={<current.icon />}
    >
      {current.label}
    </StyledButton>
  );
};

const MenuIterator = makeIterable(MenuTemplate);

export default function Settings(props: Props) {
  const { onClose, visible } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [menu, setMenu] = useState<SETTINGS>(SETTINGS.CONNECTION);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const current = getSettingMenu(menu);
  const menuList = Object.values(SETTINGS).map((value) => ({
    key: value,
    value: value as SETTINGS,
  }));

  const loadSettings = useCallback(async () => {
    if (!runtimeScopeNavigation.hasRuntimeScope) {
      setSettings(null);
      return null;
    }

    if (!hasExecutableRuntimeScopeSelector(runtimeScopeNavigation.selector)) {
      setSettings(null);
      return null;
    }

    try {
      const nextSettings = await fetchSettings(runtimeScopeNavigation.selector);
      setSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : '加载系统设置失败，请稍后重试。',
      );
      return null;
    }
  }, [runtimeScopeNavigation.hasRuntimeScope, runtimeScopeNavigation.selector]);

  const productVersion = useMemo(() => {
    return settings?.productVersion;
  }, [settings?.productVersion]);

  useEffect(() => {
    if (visible && runtimeScopeNavigation.hasRuntimeScope) {
      void loadSettings();
    }
  }, [loadSettings, runtimeScopeNavigation.hasRuntimeScope, visible]);

  const onMenuClick = ({ value }: { value: SETTINGS }) => setMenu(value);

  return (
    <StyledModal
      width={950}
      bodyStyle={{ padding: 0, height: 700 }}
      open={visible}
      footer={null}
      onCancel={onClose}
      destroyOnClose
      centered
    >
      <Layout style={{ height: '100%' }}>
        <StyledSider width={310} className="border-r border-gray-4">
          <div className="gray-9 text-bold py-3 px-5">
            <SettingOutlined className="mr-2" />
            系统设置
          </div>
          <div className="p-3 flex-grow-1">
            <MenuIterator
              data={menuList}
              currentMenu={menu}
              onClick={onMenuClick}
            />
          </div>
          {!!productVersion && (
            <div className="gray-7 d-flex align-center p-3 px-5">
              <InfoCircleOutlined className="mr-2 text-sm" />
              引擎版本：{productVersion}
            </div>
          )}
        </StyledSider>
        <Content className="d-flex flex-column">
          <div className="d-flex align-center gray-9 border-b border-gray-4 text-bold py-3 px-4">
            <current.icon className="mr-2" />
            {current.label}
          </div>
          <div className="flex-grow-1" style={{ overflowY: 'auto' }}>
            <DynamicComponent
              menu={menu}
              data={settings}
              refetch={loadSettings}
              closeModal={onClose}
            />
          </div>
        </Content>
      </Layout>
    </StyledModal>
  );
}
