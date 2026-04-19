import type useAuthSession from '@/hooks/useAuthSession';
import type { ConnectorManagementCapabilityInput } from './connectorManagementCapabilities';

export function buildConnectorManagementCapabilityInput(
  authSession: ReturnType<typeof useAuthSession>,
): ConnectorManagementCapabilityInput {
  return {
    workspaceKind: authSession.data?.workspace?.kind,
    authorizationActions: authSession.data?.authorization?.actions,
    platformRoleKeys:
      authSession.data?.authorization?.actor?.platformRoleKeys || null,
    actorIsPlatformAdmin:
      authSession.data?.authorization?.actor?.isPlatformAdmin || false,
    sessionIsPlatformAdmin: authSession.data?.isPlatformAdmin || false,
  };
}

export default buildConnectorManagementCapabilityInput;
