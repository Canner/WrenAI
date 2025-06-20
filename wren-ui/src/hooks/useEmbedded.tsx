import { useSearchParams } from 'next/navigation';
import SiderLayout from '@/components/layouts/SiderLayout';
import EmbeddedLayout from '@/components/layouts/EmbeddedLayout';


export default function useEmbdeded() {
  const isEmbedded = useSearchParams().get('embedded') === 'true';
  const DynamicLayout = isEmbedded ? EmbeddedLayout : SiderLayout;

  return { isEmbedded, DynamicLayout };
}
