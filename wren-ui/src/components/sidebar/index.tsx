import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import Exploration, { Props as ExplorationSidebarProps } from './Exploration';
import Modeling, { Props as ModelingSidebarProps } from './Modeling';

const Layout = styled.div`
  position: relative;
  min-height: 100%;
  background-color: var(--gray-3);
  color: var(--gray-8);
  padding-bottom: 24px;
  overflow-x: hidden;
`;

type Props = ModelingSidebarProps | ExplorationSidebarProps;

const DynamicSidebar = (
  props: Props & {
    pathname: string;
  },
) => {
  const { pathname, ...restProps } = props;

  if (pathname.startsWith(Path.Exploration)) {
    return <Exploration {...(restProps as ExplorationSidebarProps)} />;
  }

  if (pathname.startsWith(Path.Modeling)) {
    return <Modeling {...(restProps as ModelingSidebarProps)} />;
  }

  return null;
};

export default function Sidebar(props: Props) {
  const router = useRouter();

  return (
    <Layout>
      <DynamicSidebar {...props} pathname={router.pathname} />
    </Layout>
  );
}
