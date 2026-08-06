import { normalizeManifest } from '../manifest';

describe('normalizeManifest', () => {
  it('removes duplicate model columns case-insensitively', () => {
    const duplicateName = 'field_alpha';
    const duplicateNameWithDifferentCase = 'Field_Alpha';
    const retainedName = 'field_beta';
    const manifest = normalizeManifest({
      models: [
        {
          name: 'model_fixture',
          cached: false,
          columns: [
            {
              name: duplicateName,
              type: 'STRING',
              isCalculated: false,
            },
            {
              name: duplicateNameWithDifferentCase,
              type: 'STRING',
              isCalculated: false,
            },
            {
              name: retainedName,
              type: 'DATE',
              isCalculated: false,
            },
          ],
        },
      ],
    })!;

    expect(manifest.models[0].columns.map((column) => column.name)).toEqual([
      duplicateName,
      retainedName,
    ]);
  });
});
