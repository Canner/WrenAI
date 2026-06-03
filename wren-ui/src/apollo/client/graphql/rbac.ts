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

export const ORGANIZATION_FIELDS = gql`
  fragment OrganizationFields on Organization {
    id
    name
    slug
    isActive
    createdAt
    updatedAt
  }
`;

export const MEMBER_FIELDS = gql`
  fragment MemberFields on OrganizationMember {
    id
    organizationId
    userId
    roleId
    status
    joinedAt
    createdAt
    updatedAt
    user {
      ...UserFields
    }
    role {
      ...RoleFields
    }
    organization {
      ...OrganizationFields
    }
  }
`;

export const INVITATION_FIELDS = gql`
  fragment InvitationFields on MemberInvitation {
    id
    organizationId
    roleId
    email
    name
    token
    status
    expiresAt
    acceptedAt
    createdAt
    updatedAt
    role {
      ...RoleFields
    }
    organization {
      ...OrganizationFields
    }
  }
`;

export const LIST_RBAC_USERS = gql`
  query RbacUsers {
    organizationMembers {
      ...MemberFields
    }
    memberInvitations {
      ...InvitationFields
    }
    roles {
      ...RoleFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${MEMBER_FIELDS}
  ${INVITATION_FIELDS}
`;

export const LIST_RBAC_ROLES = gql`
  query RbacRoles {
    roles {
      ...RoleFields
    }
    organizationMembers {
      ...MemberFields
    }
  }

  ${ROLE_FIELDS}
  ${USER_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${MEMBER_FIELDS}
`;

export const LIST_USER_ROLE_MAPPINGS = gql`
  query UserRoleMappings {
    organizationMembers {
      ...MemberFields
    }
    memberInvitations {
      ...InvitationFields
    }
    roles {
      ...RoleFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${MEMBER_FIELDS}
  ${INVITATION_FIELDS}
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

export const INVITE_MEMBER = gql`
  mutation InviteMember($data: InviteMemberInput!) {
    inviteMember(data: $data) {
      ...InvitationFields
    }
  }

  ${ROLE_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${INVITATION_FIELDS}
`;

export const UPDATE_MEMBER = gql`
  mutation UpdateMember($data: UpdateMemberInput!) {
    updateMember(data: $data) {
      ...MemberFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${MEMBER_FIELDS}
`;

export const UPDATE_MEMBER_ROLE = gql`
  mutation UpdateMemberRole($data: UpdateMemberRoleInput!) {
    updateMemberRole(data: $data) {
      ...MemberFields
    }
  }

  ${USER_FIELDS}
  ${ROLE_FIELDS}
  ${ORGANIZATION_FIELDS}
  ${MEMBER_FIELDS}
`;
