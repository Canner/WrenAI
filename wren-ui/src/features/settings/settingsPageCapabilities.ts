import type { AuthSessionPayload } from '@/hooks/useAuthSession';

type PlatformManagementCapabilityInput = {
  platformRoleKeys?: string[] | null;
  actorIsPlatformAdmin?: boolean | null;
  sessionIsPlatformAdmin?: boolean | null;
};

export const canShowPlatformManagement = ({
  platformRoleKeys,
  actorIsPlatformAdmin,
  sessionIsPlatformAdmin,
}: PlatformManagementCapabilityInput) =>
  Boolean(
    platformRoleKeys?.includes('platform_admin') ||
      actorIsPlatformAdmin ||
      sessionIsPlatformAdmin,
  );

export const resolvePlatformManagementFromAuthSession = (
  authSession?: AuthSessionPayload | null,
) =>
  canShowPlatformManagement({
    platformRoleKeys: authSession?.authorization?.actor?.platformRoleKeys,
    actorIsPlatformAdmin: authSession?.authorization?.actor?.isPlatformAdmin,
    sessionIsPlatformAdmin: authSession?.isPlatformAdmin,
  });
