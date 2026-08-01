import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { BlockView } from '@/envelope/BlockView';
import { KNOWN_BLOCK_TYPES, type AnyBlock } from '@/envelope/types';
import golden from './bundleBlockTypes.golden.json';

// ECharts needs a real canvas; stub it so the chart block renders in jsdom
// (same stub used by EnvelopeView.test.tsx).
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

/**
 * Contract-sync guard between the harness bundles' `output_schema` block
 * types and this UI's renderable block union.
 *
 * A bundle is produced by compiling a profile, and the profile that defines
 * these agents is authored in the warble project rather than here — so
 * `bundleBlockTypes.golden.json` is a checked-in golden capturing the union of
 * block `type` values the genbi-default agents can emit, derived from the
 * compiled bundle snapshot in `fixtures/`. If a bundle starts emitting a type
 * this UI doesn't know about, the block would silently fall to `UnknownBlock`
 * at runtime — these tests fail loudly instead, at build time.
 *
 * Assertions are golden ⊆ known/handled, not exact-equality: the UI is
 * allowed to support more block types than the bundles currently emit
 * (e.g. a UI-only addition ahead of the bundle catching up) without
 * breaking this test.
 */

const goldenBlockTypes: string[] = golden.blockTypes;

// A minimal, valid fixture block per golden type — just enough for each
// block's renderer to mount without throwing.
const fixtureByType: Record<string, AnyBlock> = {
  table: { type: 'table', columns: ['a'], rows: [['1']] },
  definition: { type: 'definition', sql: 'SELECT 1', source_tables: ['t'], filters: [] },
  kpi_card: { type: 'kpi_card', label: 'Label', value: 1 },
  chart: { type: 'chart', chart_type: 'bar', x: 'x', series: ['y'], rows: [{ x: 'a', y: 1 }] },
  narrative: { type: 'narrative', text: 'hello' },
};

function renderBlock(block: AnyBlock) {
  return render(
    <ThemeProvider>
      <BlockView block={block} />
    </ThemeProvider>,
  );
}

describe('bundle <-> UI block-type contract sync', () => {
  it('golden fixture has a sample block for every declared type (test self-check)', () => {
    for (const type of goldenBlockTypes) {
      expect(fixtureByType, `no fixture block defined for golden type "${type}"`).toHaveProperty(
        type,
      );
    }
  });

  it('every bundle-emitted block type is in KNOWN_BLOCK_TYPES (golden ⊆ known)', () => {
    const known: readonly string[] = KNOWN_BLOCK_TYPES;
    const missing = goldenBlockTypes.filter((type) => !known.includes(type));
    expect(
      missing,
      `bundle block type(s) ${JSON.stringify(missing)} are not in KNOWN_BLOCK_TYPES — ` +
        `a harness bundle can emit a block this UI does not recognize, so it would ` +
        `silently degrade to UnknownBlock. Add a renderer + KNOWN_BLOCK_TYPES entry, ` +
        `or update the golden if this type was retired from the bundles.`,
    ).toEqual([]);
  });

  it.each(goldenBlockTypes)(
    'BlockView renders a real component for golden type "%s" (not UnknownBlock)',
    (type) => {
      const block = fixtureByType[type];
      renderBlock(block);
      expect(
        screen.queryByText(new RegExp(`Unsupported block: "${type}"`)),
        `BlockView has no real case for "${type}" — it fell through to UnknownBlock. ` +
          `Add a case to the switch in BlockView.tsx.`,
      ).not.toBeInTheDocument();
    },
  );

  it('estimate is not a bundle block type (it is a verified-state flag, fixture-only)', () => {
    // `estimate` lives on RenderEnvelope, not as a block `type`; no bundle
    // output_schema emits it as a block. Guards the fixture-only invariant
    // documented in envelope/types.ts.
    expect(goldenBlockTypes).not.toContain('estimate');
  });
});
