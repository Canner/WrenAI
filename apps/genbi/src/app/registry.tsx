import {
  SettingOutlined,
  MessageOutlined,
  AppstoreOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { AskPage } from '@/pages/AskPage';
import { AskSidebar } from '@/session/AskSidebar';
import { ArtifactsPage } from '@/artifacts/ArtifactsPage';
import { ArtifactsSidebar } from '@/artifacts/ArtifactsSidebar';
import { ContextPage } from '@/context/ContextPage';
import { ContextSidebar } from '@/context/ContextSidebar';
import { HarnessPage } from '@/harness/HarnessPage';
import { HarnessSidebar } from '@/harness/HarnessSidebar';
import { SetupPage } from '@/setup/SetupPage';
import { SetupSidebar } from '@/setup/SetupSidebar';
import { EvalPage } from '@/eval/EvalPage';
import { EvalSidebar } from '@/eval/EvalSidebar';
import { t } from '@/i18n/strings';
import { EVAL_UI_ENABLED } from '@/app/features';
import type { PageDef } from './shell/types';

/**
 * Every page that exists, whether or not it is currently surfaced. Each
 * renders real content; `pages` below is what the product actually exposes.
 */
const allPages: PageDef[] = [
  {
    key: 'setup',
    path: '/setup',
    label: t('nav.setup'),
    icon: <SettingOutlined />,
    Page: SetupPage,
    Sidebar: SetupSidebar,
  },
  {
    key: 'ask',
    path: '/ask',
    label: t('nav.ask'),
    icon: <MessageOutlined />,
    Page: AskPage,
    Sidebar: AskSidebar,
  },
  {
    key: 'artifacts',
    path: '/artifacts',
    label: t('nav.artifacts'),
    icon: <AppstoreOutlined />,
    Page: ArtifactsPage,
    Sidebar: ArtifactsSidebar,
  },
  {
    key: 'context',
    path: '/context',
    label: t('nav.context'),
    icon: <DatabaseOutlined />,
    Page: ContextPage,
    Sidebar: ContextSidebar,
  },
  {
    key: 'harness',
    path: '/harness',
    label: t('nav.harness'),
    icon: <DeploymentUnitOutlined />,
    Page: HarnessPage,
    Sidebar: HarnessSidebar,
  },
  {
    key: 'eval',
    path: '/eval',
    label: t('nav.eval'),
    icon: <ExperimentOutlined />,
    Page: EvalPage,
    Sidebar: EvalSidebar,
  },
];

/**
 * Page registry — the single source of truth for nav, routes, and per-page
 * contextual sidebar. Eval is excluded while `EVAL_UI_ENABLED` is off (deferred
 * to a later phase); with it filtered out here, the nav entry, the route, and
 * the contextual sidebar all disappear together, and `/eval` typed by hand
 * falls through the router's catch-all to `defaultPath`.
 */
export const pages: PageDef[] = allPages.filter(
  (page) => page.key !== 'eval' || EVAL_UI_ENABLED,
);

/** Landing route (product home). First-run onboarding lives at `/setup`. */
export const defaultPath = '/ask';
