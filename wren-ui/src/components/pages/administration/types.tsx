import { Tag } from 'antd';

export interface Role {
  id: number;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  users?: User[];
}

export interface User {
  id: number;
  name: string;
  email: string;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive: boolean;
  roles?: Role[];
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: number;
  organizationId: number;
  userId: number;
  roleId: number;
  status: string;
  joinedAt?: string | null;
  user: User;
  role: Role;
  organization: Organization;
  createdAt: string;
  updatedAt: string;
}

export interface MemberInvitation {
  id: number;
  organizationId: number;
  roleId: number;
  email: string;
  name?: string | null;
  token: string;
  status: string;
  expiresAt: string;
  acceptedAt?: string | null;
  role: Role;
  organization: Organization;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleMapping {
  id: number;
  userId: number;
  roleId: number;
  user: User;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export const RoleTags = ({ roles = [] }: { roles?: Role[] }) => {
  if (!roles.length) return <span className="gray-6">No roles</span>;
  return (
    <>
      {roles.map((role) => (
        <Tag key={role.id} className="mb-1">
          {role.name}
        </Tag>
      ))}
    </>
  );
};

export const StatusTag = ({ active }: { active: boolean }) => (
  <Tag color={active ? 'success' : 'default'}>
    {active ? 'Active' : 'Inactive'}
  </Tag>
);
