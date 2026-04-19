import AuthPage from './auth';
import { Path } from '@/utils/enum';
import { createCompatibilityAliasPage } from '@/utils/compatibilityRoutes';

export default createCompatibilityAliasPage(AuthPage, {
  legacyRoute: Path.Register,
  canonicalRoute: Path.Auth,
});
