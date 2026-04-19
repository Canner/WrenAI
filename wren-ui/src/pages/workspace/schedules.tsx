import SystemTasksPage from '../settings/system-tasks';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(SystemTasksPage, {
  legacyRoute: Path.WorkspaceSchedules,
  canonicalRoute: Path.SettingsSystemTasks,
});
