import {
  getThreadWorkbenchMessages,
  resolveThreadWorkbenchLocale,
} from './threadWorkbenchMessages';

describe('threadWorkbenchMessages', () => {
  it('normalizes supported locales into the local catalog keys', () => {
    expect(resolveThreadWorkbenchLocale('zh-CN')).toBe('zh-CN');
    expect(resolveThreadWorkbenchLocale('zh-TW')).toBe('zh-CN');
    expect(resolveThreadWorkbenchLocale('en-US')).toBe('en-US');
    expect(resolveThreadWorkbenchLocale('en-GB')).toBe('en-US');
  });

  it('falls back to the zh-CN catalog for unsupported or missing locales', () => {
    expect(resolveThreadWorkbenchLocale()).toBe('zh-CN');
    expect(resolveThreadWorkbenchLocale('fr-FR')).toBe('zh-CN');
  });

  it('returns translated teaser and workbench copy for the requested locale', () => {
    expect(getThreadWorkbenchMessages('zh-CN').preview.teaserAction).toBe(
      '查看数据',
    );
    expect(getThreadWorkbenchMessages('en-US').chart.actions.create).toBe(
      'Generate chart',
    );
    expect(getThreadWorkbenchMessages('en-US').footer.helpfulPrompt).toBe(
      'Was this result helpful?',
    );
  });
});
