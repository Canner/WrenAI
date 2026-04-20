import PlatformUsersPage from '@/features/settings/platform-users/ManagePlatformUsersPage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(PlatformUsersPage, {
  legacyRoute: Path.SettingsUsers,
  canonicalRoute: Path.SettingsPlatformUsers,
});
