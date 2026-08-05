import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import { DiscordIcon, GithubIcon, SparklesIcon } from '@/utils/icons';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import Home, { Props as HomeSidebarProps } from './Home';
import Modeling, { Props as ModelingSidebarProps } from './Modeling';
import Knowledge from './Knowledge';
import APIManagement from './APIManagement';
import LearningSection from '@/components/learning';

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

const StyledButton = styled(Button)`
  cursor: pointer;
  display: flex;
  align-items: center;
  padding-left: 16px;
  padding-right: 16px;
  color: var(--gray-8) !important;
  border-radius: 0;

  &:hover,
  &:focus {
    background-color: var(--gray-4);
  }
`;

const CloudCTA = styled(Link)`
  display: block;
  margin: 12px 12px 8px;
  padding: 8px 12px;
  border: 1px solid var(--geekblue-3);
  border-radius: 8px;
  background-color: var(--geekblue-1);
  color: var(--gray-8);
  transition:
    background-color 0.3s,
    border-color 0.3s;

  &:hover,
  &:focus {
    background-color: var(--geekblue-2);
    border-color: var(--geekblue-4);
    color: var(--gray-8);
  }
`;

const CloudCTATitle = styled.div`
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--geekblue-6);
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

    if (pathname.startsWith(Path.Knowledge)) {
      return <Knowledge />;
    }

    if (pathname.startsWith(Path.APIManagement)) {
      return <APIManagement />;
    }

    return null;
  };

  return <Content>{getContent()}</Content>;
};

export default function Sidebar(props: Props) {
  const { onOpenSettings } = props;
  const router = useRouter();

  const onSettingsClick = (event) => {
    onOpenSettings && onOpenSettings();
    event.target.blur();
  };

  return (
    <Layout className="d-flex flex-column">
      <DynamicSidebar {...props} pathname={router.pathname} />
      <LearningSection />
      <CloudCTA
        href="https://cloud.getwren.ai/?utm_campaign=383986378-OSS"
        target="_blank"
        rel="noopener noreferrer"
        data-ph-capture="true"
        data-ph-capture-attribute-name="cta_go_to_cloud"
      >
        <CloudCTATitle>
          <SparklesIcon className="mr-2" style={{ width: 16 }} />
          Upgrade to Wren AI Cloud
        </CloudCTATitle>
        <div className="text-xs gray-8 mt-1">
          Team collaboration, hosted deployment, and API access
        </div>
      </CloudCTA>
      <div className="border-t border-gray-4 pt-2">
        <StyledButton type="text" block onClick={onSettingsClick}>
          <SettingOutlined className="text-md" />
          Settings
        </StyledButton>
        <StyledButton type="text" block>
          <Link
            className="d-flex align-center"
            href="https://discord.com/invite/5DvshJqG8Z"
            target="_blank"
            rel="noopener noreferrer"
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_go_to_discord"
          >
            <DiscordIcon className="mr-2" style={{ width: 16 }} /> Discord
          </Link>
        </StyledButton>
        <StyledButton type="text" block>
          <Link
            className="d-flex align-center"
            href="https://github.com/Canner/WrenAI"
            target="_blank"
            rel="noopener noreferrer"
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_go_to_github"
          >
            <GithubIcon className="mr-2" style={{ width: 16 }} /> GitHub
          </Link>
        </StyledButton>
      </div>
    </Layout>
  );
}
