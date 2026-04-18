import {
  AuthorizationAction,
  AuthorizationActor,
  AuthorizationError,
  AuthorizationResource,
  authorize,
} from '@server/authz';

export type ServiceAuthorization =
  | {
      actor: AuthorizationActor;
      bypass?: false;
    }
  | {
      actor?: AuthorizationActor | null;
      bypass: true;
    };

export const assertServiceAuthorized = ({
  authorization,
  action,
  resource,
}: {
  authorization?: ServiceAuthorization | null;
  action: AuthorizationAction;
  resource: AuthorizationResource;
}) => {
  if (authorization?.bypass) {
    return;
  }

  const actor = authorization?.actor || null;
  const decision = authorize({
    actor,
    action,
    resource,
  });

  if (!decision.allowed) {
    throw new AuthorizationError(
      action,
      decision.reason || 'Permission denied',
      decision.statusCode,
    );
  }
};
