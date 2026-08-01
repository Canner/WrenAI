import { describe, it, expect } from 'vitest';
import { joinProjectPath } from '../paths';

describe('joinProjectPath', () => {
  it('joins an absolute project root with a relative file path', () => {
    expect(joinProjectPath('/Users/you/wren-projects/acme-genbi', 'wren_project/models/orders.model.yaml')).toBe(
      '/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
  });

  it('never produces a double slash when the root has a trailing slash', () => {
    expect(joinProjectPath('/Users/you/wren-projects/acme-genbi/', 'wren_project/models/orders.model.yaml')).toBe(
      '/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
  });

  it('never produces a double slash when the file path has a leading slash', () => {
    expect(joinProjectPath('/Users/you/wren-projects/acme-genbi', '/wren_project/models/orders.model.yaml')).toBe(
      '/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
  });

  it('falls back to a leading-slash relative path when projectPath is empty (unbound project)', () => {
    expect(joinProjectPath('', 'wren_project/models/orders.model.yaml')).toBe(
      '/wren_project/models/orders.model.yaml',
    );
  });
});
