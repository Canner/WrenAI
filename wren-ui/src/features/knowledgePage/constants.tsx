import ApiOutlined from '@ant-design/icons/ApiOutlined';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import IdcardOutlined from '@ant-design/icons/IdcardOutlined';
import ShoppingCartOutlined from '@ant-design/icons/ShoppingCartOutlined';
import TableOutlined from '@ant-design/icons/TableOutlined';
import type { SourceOption } from './types';

export const WIZARD_STEP_LABELS = ['引入资产', '知识配置', '保存'];

export const resolveReferenceOwner = (
  owner: string | null | undefined,
  fallback = '工作区成员',
) => {
  if (!owner || /^[0-9a-f-]{32,}$/i.test(owner)) {
    return fallback;
  }

  if (owner === 'owner' || owner === 'Owner') {
    return '演示管理员';
  }

  return owner;
};

export const CONNECTOR_SOURCE_OPTIONS: SourceOption[] = [
  {
    key: 'demo_ecommerce',
    label: '电商订单数据',
    icon: <ShoppingCartOutlined />,
    meta: '系统样例',
    category: 'demo',
  },
  {
    key: 'demo_hr',
    label: '人力资源数据',
    icon: <IdcardOutlined />,
    meta: '系统样例',
    category: 'demo',
  },
  {
    key: 'database',
    label: 'MySQL',
    icon: <DatabaseOutlined />,
    meta: '数据库',
    category: 'connector',
  },
  {
    key: 'clickhouse',
    label: 'ClickHouse',
    icon: <TableOutlined />,
    meta: 'OLAP',
    category: 'connector',
  },
  {
    key: 'api',
    label: 'REST API',
    icon: <ApiOutlined />,
    meta: '接口',
    category: 'connector',
  },
  {
    key: 'python_tool',
    label: 'Python 工具',
    icon: <CodeOutlined />,
    meta: '工具',
    category: 'connector',
  },
];

export const REFERENCE_MODAL_MASK_STYLE = {
  background: 'rgba(23, 27, 38, 0.32)',
  backdropFilter: 'blur(2px)',
};

export const blurActiveElement = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
};

export const openModalSafely = (action: () => void) => {
  if (typeof window === 'undefined') {
    blurActiveElement();
    action();
    return;
  }

  window.requestAnimationFrame(() => {
    blurActiveElement();
    action();
  });
};
