import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Dropdown, Menu, Popover, Typography } from 'antd';
import type { MenuProps } from 'antd';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import LogoutOutlined from '@ant-design/icons/LogoutOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import styled from 'styled-components';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
} from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

type Props = {
  collapsed: boolean;
  selectedKeys: string[];
  footerMenuItems: NonNullable<MenuProps['items']>;
  hasRuntimeScope: boolean;
  onAccountMenuClick: NonNullable<MenuProps['onClick']>;
  loggingOut: boolean;
  authLoading: boolean;
  accountAvatar: string;
  accountDisplayName: string;
};

const FooterNavSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FooterControlCluster = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${(props) => (props.$collapsed ? '8px' : '12px')};
`;

const SidebarWorkspaceSwitcher = styled.div`
  padding: 0 2px;
`;

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px 12px;
`;

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const AccountAvatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 70, 229, 0.1);
  color: #4338ca;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
`;

const AccountButton = styled.button<{ $collapsed?: boolean }>`
  width: 100%;
  border: 0;
  border-radius: 12px;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: ${(props) =>
    props.$collapsed ? 'center' : 'space-between'};
  gap: 8px;
  padding: ${(props) => (props.$collapsed ? '6px 0' : '8px 10px')};
  cursor: pointer;
  color: #374151;
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: rgba(229, 231, 235, 0.55);
    color: #111827;
  }
`;

const WorkspaceTrigger = styled.button<{
  $disabled?: boolean;
  $open?: boolean;
}>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$open ? 'rgba(79, 70, 229, 0.24)' : 'rgba(15, 23, 42, 0.08)'};
  border-radius: 14px;
  background: ${(props) =>
    props.$open ? 'rgba(79, 70, 229, 0.06)' : '#f8fafc'};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  text-align: left;
  cursor: ${(props) => (props.$disabled ? 'default' : 'pointer')};
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: ${(props) =>
      props.$disabled ? 'rgba(15, 23, 42, 0.08)' : 'rgba(79, 70, 229, 0.22)'};
    background: ${(props) =>
      props.$disabled ? '#f8fafc' : 'rgba(79, 70, 229, 0.05)'};
  }
`;

const WorkspaceTriggerContent = styled.div`
  min-width: 0;
  flex: 1;
`;

const WorkspaceTriggerTitle = styled.span`
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspacePopoverContent = styled.div`
  min-width: 236px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const WorkspaceOption = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(79, 70, 229, 0.24)' : 'rgba(15, 23, 42, 0.06)'};
  border-radius: 12px;
  background: ${(props) =>
    props.$active ? 'rgba(79, 70, 229, 0.06)' : '#ffffff'};
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: ${(props) => (props.$active ? 'default' : 'pointer')};
  text-align: left;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(79, 70, 229, 0.18);
    background: rgba(79, 70, 229, 0.04);
  }
`;

const WorkspaceOptionText = styled.div`
  min-width: 0;
`;

const WorkspaceOptionTitle = styled.span`
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
`;

const WorkspaceOptionCheck = styled.span`
  color: #4338ca;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const resolveWorkspaceSwitchTargetPath = (pathname: string) =>
  pathname === Path.Thread ? Path.Home : pathname;

function SidebarWorkspaceSwitchCard() {
  const router = useRouter();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const runtimeSelector = useRuntimeSelectorState();
  const selectorState = runtimeSelector.runtimeSelectorState;
  const currentWorkspace = selectorState?.currentWorkspace;
  const workspaces = selectorState?.workspaces || [];
  const baseParams = useMemo(
    () => omitRuntimeScopeQuery(router.query),
    [router.query],
  );
  const [open, setOpen] = useState(false);

  if (!selectorState || !currentWorkspace) {
    return null;
  }

  const disabled =
    runtimeSelector.initialLoading ||
    runtimeScopeTransition.transitioning ||
    workspaces.length <= 1;
  const currentWorkspaceName = getReferenceDisplayWorkspaceName(
    currentWorkspace.name,
  );

  const handleWorkspaceSelect = (workspaceId: string) => {
    if (!workspaceId || workspaceId === currentWorkspace.id || disabled) {
      setOpen(false);
      return;
    }

    const targetPath = resolveWorkspaceSwitchTargetPath(router.pathname);
    const nextUrl = buildRuntimeScopeUrl(
      targetPath,
      targetPath === router.pathname ? baseParams : {},
      { workspaceId },
    );
    setOpen(false);
    void runtimeScopeTransition.transitionTo(nextUrl);
  };

  return (
    <SidebarWorkspaceSwitcher data-testid="shell-workspace-switcher">
      <Popover
        trigger="click"
        placement="topLeft"
        visible={disabled ? false : open}
        onVisibleChange={(nextOpen) => {
          if (!disabled) {
            setOpen(nextOpen);
          }
        }}
        content={
          <WorkspacePopoverContent>
            {workspaces.map((workspace) => {
              const workspaceName = getReferenceDisplayWorkspaceName(
                workspace.name,
              );
              const active = workspace.id === currentWorkspace.id;

              return (
                <WorkspaceOption
                  key={workspace.id}
                  type="button"
                  $active={active}
                  aria-label={`切换到 ${workspaceName}`}
                  onClick={() => handleWorkspaceSelect(workspace.id)}
                >
                  <WorkspaceOptionText>
                    <WorkspaceOptionTitle>{workspaceName}</WorkspaceOptionTitle>
                  </WorkspaceOptionText>
                  {active ? (
                    <WorkspaceOptionCheck>
                      <CheckOutlined />
                    </WorkspaceOptionCheck>
                  ) : null}
                </WorkspaceOption>
              );
            })}
          </WorkspacePopoverContent>
        }
      >
        <WorkspaceTrigger
          type="button"
          $disabled={disabled}
          $open={open}
          aria-label="切换工作空间"
          aria-expanded={open}
          aria-disabled={disabled}
        >
          <WorkspaceTriggerContent>
            <WorkspaceTriggerTitle>
              {currentWorkspaceName}
            </WorkspaceTriggerTitle>
          </WorkspaceTriggerContent>
          <DownOutlined
            style={{
              color: '#9ca3af',
              fontSize: 12,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.18s ease',
            }}
          />
        </WorkspaceTrigger>
      </Popover>
    </SidebarWorkspaceSwitcher>
  );
}

export default function DolaShellFooterPanel({
  collapsed,
  selectedKeys,
  footerMenuItems,
  hasRuntimeScope,
  onAccountMenuClick,
  loggingOut,
  authLoading,
  accountAvatar,
  accountDisplayName,
}: Props) {
  return (
    <Footer>
      <FooterControlCluster $collapsed={collapsed}>
        {footerMenuItems.length > 0 ? (
          <FooterNavSection>
            <Menu
              mode="inline"
              selectedKeys={selectedKeys}
              items={footerMenuItems}
            />
          </FooterNavSection>
        ) : null}
        {!collapsed && hasRuntimeScope ? <SidebarWorkspaceSwitchCard /> : null}

        <Dropdown
          overlay={
            <Menu onClick={onAccountMenuClick}>
              <Menu.Item key="settings" icon={<SettingOutlined />}>
                系统设置
              </Menu.Item>
              <Menu.Item key="logout" icon={<LogoutOutlined />}>
                {loggingOut ? '退出中…' : '退出登录'}
              </Menu.Item>
            </Menu>
          }
          trigger={['click']}
          placement="topLeft"
        >
          <AccountButton
            type="button"
            $collapsed={collapsed}
            aria-label="账户菜单"
          >
            <AccountRow>
              <AccountAvatar>
                {authLoading ? <UserOutlined /> : accountAvatar}
              </AccountAvatar>
              {!collapsed ? (
                <div style={{ minWidth: 0 }}>
                  <Text
                    strong
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: '#111827',
                    }}
                    ellipsis
                  >
                    {authLoading ? '正在验证身份…' : accountDisplayName}
                  </Text>
                </div>
              ) : null}
            </AccountRow>
            {!collapsed ? (
              <DownOutlined style={{ color: '#9ca3af', fontSize: 12 }} />
            ) : null}
          </AccountButton>
        </Dropdown>
      </FooterControlCluster>
    </Footer>
  );
}
