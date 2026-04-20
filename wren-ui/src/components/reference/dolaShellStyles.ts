import { Layout } from 'antd';
import styled from 'styled-components';

const { Sider, Content } = Layout;

export const Shell = styled(Layout)`
  min-height: 100vh;
  background: #ffffff;
`;

export const Sidebar = styled(Sider)`
  && {
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: 100vh;
    background: #ffffff;
    border-right: 1px solid #e5e7eb;
    padding: 10px 8px 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .ant-layout-sider-children {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      gap: 12px;
    }

    .ant-menu {
      background: transparent;
      border: 0;
    }

    .ant-menu-inline > .ant-menu-item,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      height: 34px;
      line-height: 34px;
      margin: 0;
      padding-inline: 8px !important;
      border-radius: 10px;
      color: #4b5563;
      font-weight: 400;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-inline > .ant-menu-item .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-inline > .ant-menu-item:hover,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title:hover {
      background: #f7f8fb;
      color: #111827;
    }

    .ant-menu-inline > .ant-menu-item-selected {
      background: #f3f4f6;
      color: #111827;
      box-shadow: inset 2px 0 0 #d6dbe3;
    }

    .ant-menu-inline-collapsed > .ant-menu-item,
    .ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title {
      padding-inline: calc(50% - 8px) !important;
    }

    .ant-menu-item-group {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #f1f3f7;
    }

    .ant-menu-item-group:first-of-type {
      margin-top: 2px;
      padding-top: 0;
      border-top: 0;
    }

    .ant-menu-item-group-title {
      padding: 3px 10px 5px !important;
      color: #8b93a7 !important;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .ant-menu-item-group-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ant-menu-item-group-list .ant-menu-item,
    .ant-menu-item-group-list .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      min-height: 30px;
      height: 30px;
      line-height: 30px;
      margin: 0;
      padding-inline: 8px !important;
      border-radius: 9px;
      color: #4b5563;
      font-size: 13px;
      font-weight: 400;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-title-content,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-item-group-list .ant-menu-item:hover,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title:hover {
      background: #f7f8fb;
      color: #111827;
    }

    .ant-menu-item-group-list .ant-menu-item-selected {
      background: #f3f4f6;
      color: #111827;
      box-shadow: inset 2px 0 0 #d6dbe3;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-item-icon,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-item-icon {
      font-size: 13px;
    }

    &.ant-layout-sider-collapsed {
      padding: 10px 6px 0;
    }

    @media (max-width: 1120px) {
      position: static;
      align-self: stretch;
      height: auto;
      max-width: 100% !important;
      min-width: 100% !important;
      width: 100% !important;
      border-right: 0;
      border-bottom: 1px solid #e5e7eb;
    }
  }
`;

export const Main = styled(Content)<{
  $flush?: boolean;
  $flushBottom?: boolean;
}>`
  min-width: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
  background: #ffffff;
  padding: ${(props) =>
    props.$flush
      ? '0'
      : props.$flushBottom
        ? '24px 24px 0 4px'
        : '24px 24px 24px 4px'};

  @media (max-width: 1120px) {
    height: auto;
    padding: ${(props) =>
      props.$flush ? '0' : props.$flushBottom ? '16px 16px 0' : '16px'};
  }
`;

export const MainInner = styled.div`
  min-height: 100%;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

export const MainTopbar = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  flex-wrap: wrap;
`;
