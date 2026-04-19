import UsersPage from '@/features/settings/users/ManageUsersPage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(UsersPage, {
  legacyRoute: Path.SettingsAccess,
  canonicalRoute: Path.SettingsUsers,
});
