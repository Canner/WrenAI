import { useEffect } from 'react';
import { useRouter } from 'next/router';
import PageLoading from '@/components/PageLoading';
import { Path } from '@/utils/enum';

export default function AdministrationIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace(Path.AdministrationUsers);
  }, [router]);

  return <PageLoading visible />;
}
