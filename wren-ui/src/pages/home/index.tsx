import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';

export default function Ask() {
  const router = useRouter();
  const data = [];

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

  return (
    <SiderLayout loading={false} sidebar={{ data, onSelect }}>
      <Prompt />
    </SiderLayout>
  );
}
