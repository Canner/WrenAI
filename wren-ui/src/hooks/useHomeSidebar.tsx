import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { useThreadsQuery } from '@/apollo/client/graphql/home.generated';
import { useMemo } from 'react';

export default function useHomeSidebar() {
  const router = useRouter();
  const { data } = useThreadsQuery();
  const threads = useMemo(
    () =>
      (data?.threads || []).map((thread) => ({
        id: thread.id.toString(),
        name: thread.summary,
      })),
    [data],
  );

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

  return {
    data: threads,
    onSelect,
  };
}
