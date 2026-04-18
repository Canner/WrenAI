import { SETTINGS } from '@/utils/enum';
import { getSettingMenu } from './utils';

describe('settings menu labels', () => {
  it('uses connection-oriented labels', () => {
    expect(getSettingMenu(SETTINGS.CONNECTION)).toMatchObject({
      label: '连接设置',
    });
    expect(getSettingMenu(SETTINGS.PROJECT)).toMatchObject({
      label: '知识库设置',
    });
  });
});
