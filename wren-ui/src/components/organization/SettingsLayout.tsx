import { ReactNode } from 'react';
import Link from 'next/link';
import { Layout, Typography } from 'antd';
import styled from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import { Path } from '@/utils/enum';

const { Sider, Content } = Layout;

const linkStyle = { color: 'inherit', transition: 'none' };

const StyledSider = styled(Sider)`
  height: calc(100vh - 48px);
  background: var(--gray-2);
  border-right: 1px solid var(--gray-4);
  overflow-y: auto;
`;

const StyledContent = styled(Content)`
  height: calc(100vh - 48px);
  overflow-y: auto;
  background: white;
`;

const SidebarSection = styled.div`
  padding: 14px 16px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--gray-7);
`;

const SidebarItem = styled.div<{ $active?: boolean; $disabled?: boolean }>`
  padding: 6px 20px;
  color: ${(props) =>
    props.$active
      ? 'var(--gray-10)'
      : props.$disabled
        ? 'var(--gray-7)'
        : 'var(--gray-8)'};
  background: ${(props) => (props.$active ? 'var(--gray-4)' : 'transparent')};
  font-weight: ${(props) => (props.$active ? 600 : 400)};
`;

const PageBody = styled.div`
  padding: 24px 48px;
`;

const PlaceholderItem = ({ children }: { children: ReactNode }) => (
  <SidebarItem $disabled>{children}</SidebarItem>
);

export default function OrganizationSettingsLayout({
  section,
  title,
  titleExtra,
  children,
}: {
  section:
    | 'project-general'
    | 'general'
    | 'members'
    | 'danger-zone'
    | 'user-profile';
  title: ReactNode;
  titleExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SimpleLayout loading={false}>
      <Layout>
        <StyledSider width={252}>
          <SidebarSection>Project</SidebarSection>
          <SidebarItem $active={section === 'project-general'}>
            <Link style={linkStyle} href={Path.ProjectGeneral}>
              General
            </Link>
          </SidebarItem>
          <PlaceholderItem>Access control</PlaceholderItem>
          <PlaceholderItem>Data connection</PlaceholderItem>
          <PlaceholderItem>Danger zone</PlaceholderItem>

          <SidebarSection>Organization</SidebarSection>
          <SidebarItem $active={section === 'general'}>
            <Link style={linkStyle} href={Path.OrganizationGeneral}>
              General
            </Link>
          </SidebarItem>
          <SidebarItem $active={section === 'members'}>
            <Link style={linkStyle} href={Path.OrganizationMembers}>
              Members
            </Link>
          </SidebarItem>
          <PlaceholderItem>Billing</PlaceholderItem>
          <SidebarItem $active={section === 'danger-zone'}>
            <Link style={linkStyle} href={Path.OrganizationDangerZone}>
              Danger zone
            </Link>
          </SidebarItem>

          <SidebarSection>User</SidebarSection>
          <SidebarItem $active={section === 'user-profile'}>
            <Link style={linkStyle} href={Path.UserProfile}>
              Profile
            </Link>
          </SidebarItem>
          <PlaceholderItem>Danger zone</PlaceholderItem>
        </StyledSider>
        <StyledContent>
          <PageBody>
            <div className="d-flex align-center justify-space-between">
              <Typography.Title level={3} className="mb-0 gray-8">
                {title}
              </Typography.Title>
              {titleExtra}
            </div>
            {children}
          </PageBody>
        </StyledContent>
      </Layout>
    </SimpleLayout>
  );
}
