import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import Home, { Props as HomeSidebarProps } from './Home';
import Modeling, { Props as ModelingSidebarProps } from './Modeling';

const Layout = styled.div`
  position: relative;
  height: 100%;
  background-color: var(--gray-2);
  color: var(--gray-8);
  padding-bottom: 12px;
  overflow-x: hidden;
`;

const Content = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`;

type Props = (ModelingSidebarProps | HomeSidebarProps) & {
  onOpenSettings?: () => void;
};

const DynamicSidebar = (
  props: Props & {
    pathname: string;
  },
) => {
  const { pathname, ...restProps } = props;

  const getContent = () => {
    if (pathname.startsWith(Path.Home)) {
      return <Home {...(restProps as HomeSidebarProps)} />;
    }

    if (pathname.startsWith(Path.Modeling)) {
      return <Modeling {...(restProps as ModelingSidebarProps)} />;
    }

    return null;
  };

  return <Content>{getContent()}</Content>;
};

export default function Sidebar(props: Props) {
  const router = useRouter();

  return (
    <Layout className="d-flex flex-column">
      <DynamicSidebar {...props} pathname={router.pathname} />
    </Layout>
  );
}
