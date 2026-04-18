import { Path } from '@/utils/enum';
import {
  NOVA_DEFAULT_TITLE,
  resolveNovaPageTitle,
} from '@/utils/brandMeta';

describe('brandMeta', () => {
  it('returns route-specific titles for key surfaces', () => {
    expect(resolveNovaPageTitle(Path.Auth)).toBe('登录 · Nova');
    expect(resolveNovaPageTitle(Path.Home)).toBe('新对话 · Nova');
    expect(resolveNovaPageTitle(Path.Knowledge)).toBe('知识库 · Nova');
    expect(resolveNovaPageTitle(Path.SettingsPermissions)).toBe(
      '权限管理 · Nova',
    );
  });

  it('falls back to the default title for unknown routes', () => {
    expect(resolveNovaPageTitle('/unknown')).toBe(NOVA_DEFAULT_TITLE);
    expect(resolveNovaPageTitle()).toBe(NOVA_DEFAULT_TITLE);
  });
});
