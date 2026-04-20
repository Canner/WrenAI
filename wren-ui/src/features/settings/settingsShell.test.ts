import { buildSettingsConsoleShellProps } from './settingsShell';

describe('settingsShell', () => {
  it('builds the shared settings shell props with nav items and back action', async () => {
    const onNavigate = jest.fn().mockResolvedValue(true);

    const shellProps = buildSettingsConsoleShellProps({
      activeKey: 'settingsUsers',
      onNavigate,
      showPlatformAdmin: true,
    });

    expect(shellProps.hideHeader).toBe(true);
    expect(shellProps.contentBorderless).toBe(true);
    expect(shellProps.hideHistorySection).toBe(true);
    expect(shellProps.hideSidebarBranding).toBe(true);
    expect(shellProps.hideSidebarFooterPanel).toBe(true);
    expect(shellProps.hideSidebarCollapseToggle).toBe(true);
    expect(shellProps.navItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'settingsUsers' }),
      ]),
    );

    await shellProps.sidebarBackAction.onClick();
    expect(onNavigate).toHaveBeenCalledWith('/home');
  });
});
