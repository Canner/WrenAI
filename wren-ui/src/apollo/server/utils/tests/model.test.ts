import { ModelColumn } from '@server/repositories';
import { getPreviewColumnsStr } from '../model';

describe('model utils', () => {
  describe('getPreviewColumnsStr', () => {
    it('returns wildcard when no model columns exist', () => {
      expect(getPreviewColumnsStr([])).toBe('*');
    });

    it('quotes unique model reference names for preview SQL', () => {
      const columns = [
        { referenceName: 'id' },
        { referenceName: 'status' },
      ] as ModelColumn[];

      expect(getPreviewColumnsStr(columns)).toBe('"id","status"');
    });

    it('deduplicates model reference names case-insensitively', () => {
      const columns = [
        { referenceName: 'status' },
        { referenceName: 'Status' },
        { referenceName: 'bunit' },
        { referenceName: 'BUNIT' },
      ] as ModelColumn[];

      expect(getPreviewColumnsStr(columns)).toBe('"status","bunit"');
    });
  });
});
