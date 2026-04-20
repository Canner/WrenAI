import PlatformPermissionsPage from '@/features/settings/platform-permissions/ManagePlatformPermissionsPage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(PlatformPermissionsPage, {
  legacyRoute: Path.SettingsPermissions,
  canonicalRoute: Path.SettingsPlatformPermissions,
});
