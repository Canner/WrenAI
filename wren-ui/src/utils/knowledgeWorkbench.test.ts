import { Path } from '@/utils/enum';
import {
  buildKnowledgeModelingRouteParams,
  buildKnowledgeWorkbenchParams,
  isKnowledgeModelingRoute,
  resolveKnowledgeWorkbenchSection,
} from './knowledgeWorkbench';

describe('knowledgeWorkbench helpers', () => {
  it('resolves supported workbench sections with fallback', () => {
    expect(resolveKnowledgeWorkbenchSection('modeling')).toBe('modeling');
    expect(resolveKnowledgeWorkbenchSection('assets')).toBe('overview');
    expect(resolveKnowledgeWorkbenchSection('unknown')).toBe('overview');
  });

  it('builds modeling workbench params with section', () => {
    expect(
      buildKnowledgeWorkbenchParams('modeling', { openModelDrawer: true }),
    ).toEqual({ section: 'modeling', openModelDrawer: true });
    expect(buildKnowledgeWorkbenchParams('overview')).toEqual({});
  });

  it('builds modeling route params from deep-link query', () => {
    expect(
      buildKnowledgeModelingRouteParams({
        section: 'overview',
        viewId: '9',
        openAssistant: 'relationships',
        openMetadata: '1',
        ignored: 'x',
      }),
    ).toEqual({
      section: 'modeling',
      viewId: '9',
      openAssistant: 'relationships',
      openMetadata: '1',
    });
  });

  it('detects knowledge modeling routes by query section', () => {
    expect(
      isKnowledgeModelingRoute({
        pathname: Path.Knowledge,
        query: { section: 'modeling' },
      }),
    ).toBe(true);
    expect(
      isKnowledgeModelingRoute({
        pathname: Path.Knowledge,
        query: { section: 'assets' },
      }),
    ).toBe(false);
  });
});
