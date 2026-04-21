export const buildAuthResponseUser = <
  T extends {
    id: string;
    email: string;
    displayName?: string | null;
    defaultWorkspaceId?: string | null;
    isPlatformAdmin?: boolean;
  },
>({
  user,
  isPlatformAdmin,
}: {
  user: T;
  isPlatformAdmin: boolean;
}) => ({
  ...user,
  isPlatformAdmin,
  defaultWorkspaceId: user.defaultWorkspaceId ?? null,
});
