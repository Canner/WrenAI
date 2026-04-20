import PlatformWorkspacesPage from '@/features/settings/platform-workspaces/ManagePlatformWorkspacesPage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(PlatformWorkspacesPage, {
  legacyRoute: Path.Workspace,
  canonicalRoute: Path.SettingsPlatformWorkspaces,
});
