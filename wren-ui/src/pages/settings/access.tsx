import UsersPage from './users';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(UsersPage, {
  legacyRoute: Path.SettingsAccess,
  canonicalRoute: Path.SettingsUsers,
});
