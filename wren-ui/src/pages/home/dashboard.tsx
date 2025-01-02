import SiderLayout from '@/components/layouts/SiderLayout';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import DashboardGrid from '@/components/pages/home/dashboardGrid';

export default function Dashboard() {
  const homeSidebar = useHomeSidebar();
  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      <DashboardGrid />
    </SiderLayout>
  );
}
