import PageLoading from '@/components/PageLoading';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';

export default function ManageHomeIndexPage() {
  useWithOnboarding();

  return <PageLoading visible />;
}
