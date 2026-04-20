import {
  buildNovaSettingsNavItems,
  type NovaShellNavKey,
} from '@/components/reference/novaShellNavigation';
import { Path } from '@/utils/enum';

type SettingsShellConfig = {
  activeKey: NovaShellNavKey;
  onNavigate: (
    path: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => Promise<boolean>;
  showPlatformAdmin: boolean;
  hideHeader?: boolean;
  contentBorderless?: boolean;
  hideHistorySection?: boolean;
};

export const buildSettingsConsoleShellProps = ({
  activeKey,
  onNavigate,
  showPlatformAdmin,
  hideHeader = true,
  contentBorderless = true,
  hideHistorySection = true,
}: SettingsShellConfig) => ({
  navItems: buildNovaSettingsNavItems({
    activeKey,
    onNavigate,
    showPlatformAdmin,
  }),
  hideHeader,
  contentBorderless,
  hideHistorySection,
  sidebarBackAction: {
    label: '返回主菜单',
    onClick: () => onNavigate(Path.Home),
  },
  hideSidebarBranding: true,
  hideSidebarFooterPanel: true,
  hideSidebarCollapseToggle: true,
});
