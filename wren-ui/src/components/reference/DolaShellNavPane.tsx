import type { ReactNode } from 'react';
import { Button, Menu } from 'antd';
import type { MenuProps } from 'antd';
import MenuFoldOutlined from '@ant-design/icons/MenuFoldOutlined';
import MenuUnfoldOutlined from '@ant-design/icons/MenuUnfoldOutlined';
import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';
import styled from 'styled-components';
import NovaBrandMark from '@/components/brand/NovaBrandMark';

export type DolaShellBackAction = {
  label: string;
  onClick: () => void;
};

type Props = {
  collapsed: boolean;
  isHomeActive: boolean;
  sidebarBackAction?: DolaShellBackAction;
  hideBranding?: boolean;
  hideCollapseToggle?: boolean;
  onPrimaryAction?: () => void;
  primaryActionLabel: string;
  primaryActionIcon?: ReactNode;
  selectedKeys: string[];
  menuItems: NonNullable<MenuProps['items']>;
  onToggleCollapsed: () => void;
};

const BrandBlock = styled.div<{
  $collapsed?: boolean;
  $hideBranding?: boolean;
}>`
  display: flex;
  align-items: center;
  justify-content: ${(props) =>
    props.$hideBranding ? 'flex-end' : 'space-between'};
  gap: 8px;
  padding: ${(props) => (props.$hideBranding ? '0 2px' : '4px 2px 0')};
  min-height: ${(props) => (props.$hideBranding ? '0' : '32px')};
  flex-shrink: 0;
`;

const CollapseToggleButton = styled(Button)<{ $collapsed?: boolean }>`
  && {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    color: #6b7280;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;

    &:hover,
    &:focus {
      color: #111827;
      background: rgba(229, 231, 235, 0.65);
    }
  }
`;

const BrandIdentity = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const BrandMarkFrame = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 100%);
  border: 1px solid rgba(79, 70, 229, 0.1);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
  flex-shrink: 0;
`;

const BrandTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #111827;
`;

const NavSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
`;

const SidebarBackButton = styled(Button)<{ $collapsed?: boolean }>`
  && {
    width: 100%;
    height: 34px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: ${(props) => (props.$collapsed ? 'center' : 'flex-start')};
    gap: 6px;
    padding-inline: ${(props) => (props.$collapsed ? '0' : '6px')} !important;
    color: #4b5563;
    border: 0;
    background: transparent;
    font-weight: 500;

    &:hover,
    &:focus {
      color: #111827;
      background: rgba(229, 231, 235, 0.55);
    }
  }
`;

export default function DolaShellNavPane({
  collapsed,
  isHomeActive,
  sidebarBackAction,
  hideBranding = false,
  hideCollapseToggle = false,
  onPrimaryAction,
  primaryActionLabel,
  primaryActionIcon,
  selectedKeys,
  menuItems,
  onToggleCollapsed,
}: Props) {
  return (
    <>
      <BrandBlock $collapsed={collapsed} $hideBranding={hideBranding}>
        {!collapsed && !hideBranding ? (
          <BrandIdentity>
            <BrandMarkFrame aria-hidden>
              <NovaBrandMark size={22} />
            </BrandMarkFrame>
            <div>
              <BrandTitle>Nova</BrandTitle>
            </div>
          </BrandIdentity>
        ) : null}
        {hideCollapseToggle ? null : (
          <CollapseToggleButton
            type="text"
            size="small"
            $collapsed={collapsed}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            onClick={onToggleCollapsed}
          />
        )}
      </BrandBlock>

      <NavSection>
        {sidebarBackAction ? (
          <SidebarBackButton
            type="text"
            size="small"
            block={!collapsed}
            $collapsed={collapsed}
            icon={<ArrowLeftOutlined />}
            aria-label={sidebarBackAction.label}
            onClick={sidebarBackAction.onClick}
          >
            {collapsed ? null : sidebarBackAction.label}
          </SidebarBackButton>
        ) : null}

        {onPrimaryAction ? (
          <Button
            type={isHomeActive ? 'primary' : 'default'}
            size="large"
            block
            icon={primaryActionIcon}
            onClick={onPrimaryAction}
          >
            {collapsed ? null : primaryActionLabel}
          </Button>
        ) : null}

        <Menu mode="inline" selectedKeys={selectedKeys} items={menuItems} />
      </NavSection>
    </>
  );
}
