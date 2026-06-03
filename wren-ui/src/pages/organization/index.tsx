import { useEffect } from 'react';
import { useRouter } from 'next/router';
import PageLoading from '@/components/PageLoading';
import { Path } from '@/utils/enum';

export default function OrganizationIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace(Path.OrganizationGeneral);
  }, [router]);

  return <PageLoading visible />;
}
