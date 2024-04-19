import { useEffect, useState } from 'react';
import { Modal, Layout, Button } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES, SETTINGS } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import { ModalAction } from '@/hooks/useModalAction';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import DataSourceSettings from './DataSourceSettings';
import ProjectSettings from './ProjectSettings';
import { getSettingMenu } from './utils';
import {
  useGetSettingsLazyQuery,
  GetSettingsQuery,
} from '@/apollo/client/graphql/settings.generated';

const { Sider, Content } = Layout;

type Props = ModalAction<any, any> & {
  loading?: boolean;
};

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
}: {
  menu: SETTINGS;
  data?: GetSettingsQuery['settings'];
  refetch: () => void;
}) => {
  const { dataSource } = data || {};
  return (
    {
      [SETTINGS.DATA_SOURCE]: (
        <DataSourceSettings
          type={dataSource?.type as unknown as DATA_SOURCES}
          sampleDataset={dataSource?.sampleDataset}
          properties={dataSource?.properties}
          refetchSettings={refetch}
        />
      ),
      [SETTINGS.PROJECT]: <ProjectSettings />,
    }[menu] || null
  );
};

const MenuTemplate = ({ currentMenu, value, onClick }) => {
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
  const [menu, setMenu] = useState<SETTINGS>(SETTINGS.DATA_SOURCE);
  const current = getSettingMenu(menu);
  const menuList = Object.keys(SETTINGS).map((key) => ({
    key,
    value: SETTINGS[key],
  }));
  const [fetchSettings, { data, refetch }] = useGetSettingsLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  useEffect(() => {
    if (visible) fetchSettings();
  }, [visible]);

  const onMenuClick = ({ value }) => setMenu(value);

  return (
    <StyledModal
      width={950}
      bodyStyle={{ padding: 0, height: 700 }}
      visible={visible}
      footer={null}
      onCancel={onClose}
      destroyOnClose
      centered
    >
      <Layout style={{ height: '100%' }}>
        <Sider width={310} className="border-r border-gray-4">
          <div className="gray-9 text-bold py-3 px-5">
            <SettingOutlined className="mr-2" />
            Settings
          </div>
          <div className="p-3">
            <MenuIterator
              data={menuList}
              currentMenu={menu}
              onClick={onMenuClick}
            />
          </div>
        </Sider>
        <Content className="d-flex flex-column">
          <div className="d-flex align-center gray-9 border-b border-gray-4 text-bold py-3 px-4">
            <current.icon className="mr-2" />
            {current.label}
          </div>
          <div className="flex-grow-1" style={{ overflowY: 'auto' }}>
            <DynamicComponent
              menu={menu}
              data={data?.settings}
              refetch={refetch}
            />
          </div>
        </Content>
      </Layout>
    </StyledModal>
  );
}
