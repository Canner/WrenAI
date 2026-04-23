import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';

export default function ModelingAssistantRouteLayout({
  title,
  description,
  onBack,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <ConsoleShellLayout
      activeNav="knowledge"
      navItems={[]}
      eyebrow="Modeling AI Assistant"
      title={title}
      description={description}
      hideHistorySection
      hideSidebarBranding
      hideSidebarFooterPanel
      hideSidebarCollapseToggle
      titleExtra={
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          Back to modeling
        </Button>
      }
    >
      {children}
    </ConsoleShellLayout>
  );
}
