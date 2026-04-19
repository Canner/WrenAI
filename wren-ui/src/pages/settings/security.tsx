import { Path } from '@/utils/enum';
import {
  CompatibilityRedirectPage,
  createCompatibilityRedirect,
} from '@/utils/compatibilityRoutes';

export const getServerSideProps = createCompatibilityRedirect(Path.Settings);

export default CompatibilityRedirectPage;
