# RBAC Foundation

This document describes the application-level RBAC foundation in Wren UI. It does not enforce permissions yet; it establishes durable role, user, and user-role assignment primitives for future governance work.

## Scope

Implemented:

- Roles: `Admin`, `Manager`, `Analyst`, `Viewer`, plus custom roles.
- Users with local identity metadata.
- User-role mappings.
- GraphQL APIs for role, user, and assignment management.
- Administration UI for user management, role management, and role assignment.

Deferred:

- Authorization middleware.
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

Mutations:

- `createRole`
- `updateRole`
- `createUser`
- `updateUser`
- `assignRoleToUser`
- `updateUserRoles`
- `removeRoleFromUser`

## UI

Navigation:

- Header tab: `Admin`
- Sidebar section: `Administration`

Screens:

- `/administration/users`
- `/administration/roles`
- `/administration/assignments`

The UI uses the existing Next.js, Apollo Client, Ant Design, and `SiderLayout`/`PageLayout` patterns.

## Future Permission Model

Future schema-level or table-level permissions should be added as separate tables referencing `roles.id`, for example:

- `role_schema_permissions`
- `role_table_permissions`
- `role_policy_bindings`

This keeps identity and assignment management stable while allowing governance policies to evolve independently.
