import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';

export default function useHomeSidebar() {
  const router = useRouter();

  // TODO: call API to get real thread list data
  const data = [
    { name: 'aaaa', id: 'aaa' },
    { name: 'bbbb', id: 'bbb' },
  ];

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

  return {
    data,
    onSelect,
  };
}
