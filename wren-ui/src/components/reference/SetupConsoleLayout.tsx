import { ReactNode } from 'react';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';

interface Props {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export default function SetupConsoleLayout({
  title,
  description,
  children,
}: Props) {
  const onboarding = useWithOnboarding();

  return (
    <ConsoleShellLayout
      activeNav="knowledge"
      title={title}
      description={description}
      hideHeader
      contentBorderless
      loading={onboarding.loading}
    >
      {children}
    </ConsoleShellLayout>
  );
}
