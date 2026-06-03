# RBAC Foundation

This document describes the application-level organization and member RBAC foundation in Wren UI. It establishes durable organization, user, member, invitation, session, and role primitives for future governance work.

## Scope

Implemented:

- Roles: `Admin`, `Manager`, `Analyst`, `Viewer`, plus custom roles.
- Organizations with active members.
- Users with local identity metadata and password hashes for local login.
- Organization-member role assignments.
- Member invitations and local auth sessions.
- GraphQL APIs for role, member, invitation, and assignment management.
- Administration UI for member management, role management, and role assignment.

Deferred:

- Authorization middleware for the existing AI/query APIs.
- Governance policies.
- Data scoping.
- SQL validation.
- Schema/table-level permissions.
- Teams, LDAP, and Azure AD synchronization.

## Database Model

Tables:

- `roles`
  - `id`
  - `name`
  - `description`
  - timestamps
- `users`
  - `id`
  - `name`
  - `email`
  - `external_id`
  - `identity_provider`
  - `is_active`
  - timestamps
- `user_roles`
  - `id`
  - `user_id`
  - `role_id`
  - timestamps
- `organizations`
  - `id`
  - `name`
  - `slug`
  - external identity fields
  - `is_active`
  - timestamps
- `organization_members`
  - `id`
  - `organization_id`
  - `user_id`
  - `role_id`
  - `status`
  - `joined_at`
  - timestamps
- `member_invitations`
  - `id`
  - `organization_id`
  - `role_id`
  - `email`
  - `token`
  - `status`
  - `expires_at`
  - timestamps
- `auth_sessions`
  - `id`
  - `user_id`
  - `organization_member_id`
  - `token`
  - `expires_at`
  - `revoked_at`
  - timestamps

`external_id` and `identity_provider` are intentionally present now so Teams, LDAP, and Azure AD integrations can later attach external identities without replacing the RBAC tables.

## Backend Layers

- Migration: `migrations/20250602000000_create_rbac_tables.js`
- Models: `src/apollo/server/models/rbac.ts`
- Repositories: `src/apollo/server/repositories/rbacRepository.ts`
- Service: `src/apollo/server/services/rbacService.ts`
- Resolver: `src/apollo/server/resolvers/rbacResolver.ts`
- GraphQL schema: `src/apollo/server/schema.ts`

The service owns validation and duplicate checks. The repository owns persistence and joined user-role mapping queries.

## GraphQL API

Queries:

- `roles`
- `users`
- `userRoleMappings`
- `organizations`
- `organizationMembers`
- `memberInvitations`
- `currentSession`
- `bootstrapStatus`

Mutations:

- `createRole`
- `updateRole`
- `createUser`
- `updateUser`
- `assignRoleToUser`
- `updateUserRoles`
- `removeRoleFromUser`
- `inviteMember`
- `updateMember`
- `updateMemberRole`

Admin-only behavior:

- Inviting members.
- Creating and editing roles.
- Editing members and updating member roles.
- Legacy user-role mutation paths are also guarded for Admin members.

## UI

Navigation:

- Header tab: `Admin`
- Sidebar section: `Administration`

Screens:

- `/administration/users` (Member Management)
- `/administration/roles`
- `/administration/assignments`

The UI uses the existing Next.js, Apollo Client, Ant Design, and `SiderLayout`/`PageLayout` patterns.

Authentication routes:

- `/login`
- `/accept-invitation?token=...`

The first Admin can bootstrap the first organization when no active Admin member exists.

## Future Permission Model

Future schema-level or table-level permissions should be added as separate tables referencing `roles.id`, for example:

- `role_schema_permissions`
- `role_table_permissions`
- `role_policy_bindings`

This keeps identity and assignment management stable while allowing governance policies to evolve independently.
