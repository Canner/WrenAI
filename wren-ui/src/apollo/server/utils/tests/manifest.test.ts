import { normalizeManifest } from '../manifest';

describe('normalizeManifest', () => {
  it('removes duplicate model columns case-insensitively', () => {
    const manifest = normalizeManifest({
      models: [
        {
          name: 'orders',
          cached: false,
          columns: [
            {
              name: 'taskowner',
              type: 'STRING',
              isCalculated: false,
            },
            {
              name: 'TaskOwner',
              type: 'STRING',
              isCalculated: false,
            },
            {
              name: 'taskdue',
              type: 'DATE',
              isCalculated: false,
            },
          ],
        },
      ],
    })!;

    expect(manifest.models[0].columns.map((column) => column.name)).toEqual([
      'taskowner',
      'taskdue',
    ]);
  });
});
