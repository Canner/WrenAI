import DiagnosticsPage from '@/features/settings/diagnostics/ManageDiagnosticsPage';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(DiagnosticsPage, {
  legacyRoute: Path.APIManagementHistory,
  canonicalRoute: Path.SettingsDiagnostics,
});
