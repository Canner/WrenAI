import { Layout } from 'antd';
import HeaderBar from '@/components/HeaderBar';
import PageLoading from '@/components/PageLoading';

const { Content } = Layout;

interface Props {
  children: React.ReactNode;
  loading?: boolean;
}

export default function SimpleLayout(props: Props) {
  const { children, loading } = props;
  return (
    <Layout
      className={`adm-main bg-gray-3${loading ? ' overflow-hidden' : ''}`}
    >
      <HeaderBar />
      <Content className="adm-content">{children}</Content>
      <PageLoading visible={loading} />
    </Layout>
  );
}
