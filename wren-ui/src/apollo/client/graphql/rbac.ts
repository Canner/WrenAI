import { gql } from '@apollo/client';

export const ROLE_FIELDS = gql`
  fragment RoleFields on Role {
    id
    name
    description
    createdAt
    updatedAt
  }
`;

export const USER_FIELDS = gql`
  fragment UserFields on User {
    id
    name
    email
    externalId
    identityProvider
    isActive
    createdAt
    updatedAt
  }
`;

export const LIST_RBAC_USERS = gql`
  query RbacUsers {
    users {
      ...UserFields
      roles {
        ...RoleFields
      }
    }
    roles {
      ...RoleFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
`;

export const LIST_RBAC_ROLES = gql`
  query RbacRoles {
    roles {
      ...RoleFields
      users {
        ...UserFields
      }
    }
    users {
      ...UserFields
    }
  }

  ${ROLE_FIELDS}
  ${USER_FIELDS}
`;

export const LIST_USER_ROLE_MAPPINGS = gql`
  query UserRoleMappings {
    userRoleMappings {
      id
      userId
      roleId
      createdAt
      updatedAt
      user {
        ...UserFields
        roles {
          ...RoleFields
        }
      }
      role {
        ...RoleFields
      }
    }
    users {
      ...UserFields
      roles {
        ...RoleFields
      }
    }
    roles {
      ...RoleFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
`;

export const CREATE_ROLE = gql`
  mutation CreateRole($data: CreateRoleInput!) {
    createRole(data: $data) {
      ...RoleFields
    }
  }

  ${ROLE_FIELDS}
`;

export const UPDATE_ROLE = gql`
  mutation UpdateRole($where: RoleWhereInput!, $data: UpdateRoleInput!) {
    updateRole(where: $where, data: $data) {
      ...RoleFields
    }
  }

  ${ROLE_FIELDS}
`;

export const CREATE_USER = gql`
  mutation CreateUser($data: CreateUserInput!) {
    createUser(data: $data) {
      ...UserFields
      roles {
        ...RoleFields
      }
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
`;

export const UPDATE_USER = gql`
  mutation UpdateUser($where: UserWhereInput!, $data: UpdateUserInput!) {
    updateUser(where: $where, data: $data) {
      ...UserFields
      roles {
        ...RoleFields
      }
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
`;

export const ASSIGN_ROLE_TO_USER = gql`
  mutation AssignRoleToUser($data: UserRoleInput!) {
    assignRoleToUser(data: $data) {
      id
      userId
      roleId
    }
  }
`;

export const UPDATE_USER_ROLES = gql`
  mutation UpdateUserRoles($data: UpdateUserRolesInput!) {
    updateUserRoles(data: $data) {
      ...UserFields
      roles {
        ...RoleFields
      }
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
`;

export const REMOVE_ROLE_FROM_USER = gql`
  mutation RemoveRoleFromUser($data: UserRoleInput!) {
    removeRoleFromUser(data: $data)
  }
`;
