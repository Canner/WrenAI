import crypto from 'crypto';
import type {
  IPermissionRepository,
  IRolePermissionRepository,
  IRoleRepository,
} from '@server/repositories';
import { legacyRolePolicyMap } from './legacyRolePolicy';
import { AUTHORIZATION_ACTIONS } from './permissionRegistry';
import { PLATFORM_SCOPE_ID } from './roleMapping';

type EnsureAuthorizationCatalogSeededDeps = {
  roleRepository: IRoleRepository;
  permissionRepository: IPermissionRepository;
  rolePermissionRepository: IRolePermissionRepository;
};

type SystemRoleSeedDefinition = {
  name: string;
  scopeType: 'platform' | 'workspace';
  scopeId: string;
  displayName: string;
  description: string;
  permissionNames: string[];
};

const PLATFORM_IAM_ADMIN_ACTIONS = [
  'platform.user.read',
  'platform.user.create',
  'platform.user.update',
  'platform.user.role.assign',
  'platform.user.workspace.assign',
  'platform.role.read',
  'platform.role.create',
  'platform.role.update',
  'platform.role.delete',
] as const;

const PLATFORM_WORKSPACE_ADMIN_ACTIONS = [
  'platform.workspace.read',
  'workspace.create',
  'platform.workspace.member.manage',
  'platform.user.workspace.assign',
  'platform.system_task.read',
  'platform.system_task.manage',
] as const;

const PLATFORM_AUDITOR_ACTIONS = [
  'platform.user.read',
  'platform.role.read',
  'platform.workspace.read',
  'platform.audit.read',
  'platform.diagnostics.read',
  'platform.system_task.read',
] as const;

const PLATFORM_SUPPORT_READONLY_ACTIONS = [
  'platform.user.read',
  'platform.role.read',
  'platform.workspace.read',
  'platform.audit.read',
  'platform.diagnostics.read',
  'platform.system_task.read',
] as const;

const PLATFORM_SUPPORT_IMPERSONATOR_ACTIONS = [
  ...PLATFORM_SUPPORT_READONLY_ACTIONS,
  'impersonation.start',
] as const;

const SYSTEM_ROLE_SEED_DEFINITIONS: SystemRoleSeedDefinition[] = [
  {
    name: 'platform_admin',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '平台管理员',
    description: '管理平台级菜单、跨空间治理与高风险平台动作。',
    permissionNames: legacyRolePolicyMap.platform_admin,
  },
  {
    name: 'platform_iam_admin',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '平台权限管理员',
    description: '负责平台用户目录、角色目录与平台角色分配。',
    permissionNames: [...PLATFORM_IAM_ADMIN_ACTIONS],
  },
  {
    name: 'platform_workspace_admin',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '平台空间管理员',
    description: '负责工作空间列表、创建、成员治理、系统任务与用户分配。',
    permissionNames: [...PLATFORM_WORKSPACE_ADMIN_ACTIONS],
  },
  {
    name: 'platform_auditor',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '平台审计员',
    description: '负责只读查看平台目录、工作空间与观测数据。',
    permissionNames: [...PLATFORM_AUDITOR_ACTIONS],
  },
  {
    name: 'support_readonly',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '支持只读',
    description: '面向支持与运营排障，只读查看平台目录、空间、审计与诊断。',
    permissionNames: [...PLATFORM_SUPPORT_READONLY_ACTIONS],
  },
  {
    name: 'support_impersonator',
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    displayName: '支持代理员',
    description: '在严格审计下发起身份模拟，并保留只读排障能力。',
    permissionNames: [...PLATFORM_SUPPORT_IMPERSONATOR_ACTIONS],
  },
  {
    name: 'workspace_owner',
    scopeType: 'workspace',
    scopeId: '',
    displayName: '所有者',
    description: '管理工作空间成员、资源治理与关键配置。',
    permissionNames: legacyRolePolicyMap.owner,
  },
  {
    name: 'workspace_admin',
    scopeType: 'workspace',
    scopeId: '',
    displayName: '管理员',
    description: '兼容历史工作空间管理员角色，当前能力与所有者等价。',
    permissionNames: legacyRolePolicyMap.admin,
  },
  {
    name: 'workspace_viewer',
    scopeType: 'workspace',
    scopeId: '',
    displayName: '查看者',
    description: '查看工作空间资源并使用只读能力。',
    permissionNames: legacyRolePolicyMap.member,
  },
];

const buildRoleKey = ({
  name,
  scopeType,
  scopeId,
}: {
  name: string;
  scopeType: string;
  scopeId?: string | null;
}) => `${scopeType}:${String(scopeId || '')}:${name}`;

export const ensureAuthorizationCatalogSeeded = async ({
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
}: EnsureAuthorizationCatalogSeededDeps) => {
  const tx = await roleRepository.transaction();
  try {
    const [existingPermissions, existingRoles, existingRolePermissions] =
      await Promise.all([
        permissionRepository.findAll({ tx }),
        roleRepository.findAll({ tx }),
        rolePermissionRepository.findAll({ tx }),
      ]);

    const permissionByName = new Map(
      existingPermissions.map((permission) => [permission.name, permission]),
    );
    const missingPermissionPayloads = Object.entries(AUTHORIZATION_ACTIONS)
      .filter(([name]) => !permissionByName.has(name))
      .map(([name, meta]) => ({
        id: crypto.randomUUID(),
        name,
        scopeType: meta.scope,
        description: meta.description,
      }));

    if (missingPermissionPayloads.length > 0) {
      const createdPermissions = await permissionRepository.createMany(
        missingPermissionPayloads,
        { tx },
      );
      createdPermissions.forEach((permission) => {
        permissionByName.set(permission.name, permission);
      });
    }

    const roleByKey = new Map(
      existingRoles.map((role) => [buildRoleKey(role), role]),
    );

    for (const definition of SYSTEM_ROLE_SEED_DEFINITIONS) {
      const roleKey = buildRoleKey(definition);
      if (roleByKey.has(roleKey)) {
        continue;
      }

      const createdRole = await roleRepository.createOne(
        {
          id: crypto.randomUUID(),
          name: definition.name,
          scopeType: definition.scopeType,
          scopeId: definition.scopeId,
          displayName: definition.displayName,
          description: definition.description,
          isSystem: true,
          isActive: true,
          createdBy: null,
        },
        { tx },
      );
      roleByKey.set(roleKey, createdRole);
    }

    const existingRolePermissionKeys = new Set(
      existingRolePermissions.map(
        (rolePermission) =>
          `${rolePermission.roleId}:${rolePermission.permissionId}`,
      ),
    );
    const missingRolePermissionPayloads = SYSTEM_ROLE_SEED_DEFINITIONS.flatMap(
      (definition) => {
        const role = roleByKey.get(buildRoleKey(definition));
        if (!role) {
          return [];
        }

        return definition.permissionNames.flatMap((permissionName) => {
          const permission = permissionByName.get(permissionName);
          if (!permission) {
            return [];
          }
          const rolePermissionKey = `${role.id}:${permission.id}`;
          if (existingRolePermissionKeys.has(rolePermissionKey)) {
            return [];
          }
          existingRolePermissionKeys.add(rolePermissionKey);
          return [
            {
              id: crypto.randomUUID(),
              roleId: role.id,
              permissionId: permission.id,
            },
          ];
        });
      },
    );

    if (missingRolePermissionPayloads.length > 0) {
      await rolePermissionRepository.createMany(missingRolePermissionPayloads, {
        tx,
      });
    }

    await roleRepository.commit(tx);
  } catch (error) {
    await roleRepository.rollback(tx);
    throw error;
  }
};
