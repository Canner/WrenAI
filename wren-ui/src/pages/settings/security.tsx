import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/settings',
    permanent: false,
  },
});

export default function SettingsSecurityRedirectPage() {
  return null;
}
