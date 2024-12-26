import SiderLayout from '@/components/layouts/SiderLayout';
import useHomeSidebar from '@/hooks/useHomeSidebar';

export default function Dashboard() {
  const homeSidebar = useHomeSidebar();
  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      Dashboard
    </SiderLayout>
  );
}
