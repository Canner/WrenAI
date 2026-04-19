import WorkspacePage from '@/features/workspace/ManageWorkspacePage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(WorkspacePage, {
  legacyRoute: Path.SettingsWorkspace,
  canonicalRoute: Path.Workspace,
});
