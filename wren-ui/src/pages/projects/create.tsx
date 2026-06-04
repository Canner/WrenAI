import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button, Layout, Typography } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import { WorkspaceProjectType } from '@/apollo/client/graphql/__types__';

const { Header, Content } = Layout;

const StyledHeader = styled(Header)`
  height: 48px;
  border-bottom: 1px solid var(--gray-5);
  background: var(--gray-10);
  padding: 10px 16px;
`;

const Page = styled(Content)`
  min-height: calc(100vh - 48px);
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at top center, rgba(59, 89, 230, 0.1), transparent 36%),
    var(--gray-1);
`;

const Card = styled.div`
  width: 528px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
  padding: 36px;
`;

const IncludedList = styled.ul`
  margin: 24px 0 32px;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    color: var(--gray-8);
  }
`;

const ItemBadge = styled.span`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid var(--gray-4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--gray-7);
  font-size: 14px;
`;

const PROJECT_BENEFITS = [
  'Agentic Mode for autonomous, multi-step exploration',
  'Knowledge that captures itself from conversations',
  'Skills for reusable analysis workflows',
  'Memory that retains context across sessions',
  'Artifacts for charts, dashboards, and reports',
];

export default function ProjectCreatePage() {
  const router = useRouter();

  const startProjectSetup = async (projectType: WorkspaceProjectType) => {
    await router.push({
      pathname: Path.OnboardingConnection,
      query: {
        newProject: '1',
        projectType,
      },
    });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <StyledHeader>
        <LogoBar />
      </StyledHeader>
      <Page>
        <div style={{ width: 640, textAlign: 'center' }}>
          <Typography.Title level={1} style={{ marginBottom: 12 }}>
            Create your first agentic project
          </Typography.Title>
          <Typography.Paragraph className="gray-7 text-md">
            An AI analyst that plans, explores, and answers across data. Memory
            and knowledge compound with every session.
          </Typography.Paragraph>
          <Card>
            <Typography.Text className="gray-6 text-sm text-medium">
              WHAT&apos;S INCLUDED?
            </Typography.Text>
            <IncludedList>
              {PROJECT_BENEFITS.map((item) => (
                <li key={item}>
                  <ItemBadge>+</ItemBadge>
                  <span>{item}</span>
                </li>
              ))}
            </IncludedList>
            <Button
              type="primary"
              size="large"
              block
              onClick={() => void startProjectSetup(WorkspaceProjectType.AGENTIC)}
            >
              Create project
            </Button>
          </Card>
          <Typography.Paragraph className="gray-6 text-sm mt-6">
            Looking for the classic experience?{' '}
            <Link
              href={{
                pathname: Path.OnboardingConnection,
                query: {
                  newProject: '1',
                  projectType: WorkspaceProjectType.CLASSIC,
                },
              }}
            >
              Create a classic project instead.
            </Link>
          </Typography.Paragraph>
        </div>
      </Page>
    </Layout>
  );
}
