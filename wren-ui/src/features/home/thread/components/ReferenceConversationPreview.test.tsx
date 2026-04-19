import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReferenceConversationPreview from './ReferenceConversationPreview';

describe('ReferenceConversationPreview', () => {
  it('renders question and suggested follow-up copy', () => {
    const html = renderToStaticMarkup(
      <ReferenceConversationPreview question="每个供应商单产品的成本趋势" />,
    );

    expect(html).toContain('每个供应商单产品的成本趋势');
    expect(html).toContain('推荐几个问题给我');
    expect(html).toContain('当前示例会沿用该线程历史使用的知识库继续分析');
  });
});
