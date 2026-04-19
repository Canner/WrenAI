import { getServerSideProps } from '../../../pages/settings/security';
import { Path } from '@/utils/enum';

describe('settings/security compatibility route', () => {
  it('redirects /settings/security to the canonical settings profile page', async () => {
    await expect(getServerSideProps({} as any)).resolves.toEqual({
      redirect: {
        destination: Path.Settings,
        permanent: false,
      },
    });
  });
});
