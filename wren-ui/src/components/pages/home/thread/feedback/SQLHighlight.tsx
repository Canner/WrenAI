import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Tag } from 'antd';
import { groupBy } from 'lodash';
import styled from 'styled-components';
import { getReferenceIcon, Reference } from './utils';
import { getTokenizer } from '@/components/editor/CodeBlock';

const SQLWrapper = styled.div`
  position: absolute;
  top: 0;
  left: 28px;
  right: 0;
  z-index: 1;
  font-size: 14px;
  color: var(--gray-9);
  margin: 0 3px;

  .sqlHighlight__line {
    background-color: white;
  }

  .sqlHighlight__block {
    position: relative;
    &:hover,
    &.isActive {
      mark {
        background-color: rgba(250, 219, 20, 0.3);
      }
    }
  }

  mark {
    cursor: pointer;
    position: relative;
    color: currentColor;
    background-color: transparent;
    border-bottom: 1px dashed var(--gray-5);
    padding: 2px 0;
  }

  .sqlHighlight__tags {
    user-select: none;
    padding: 0 4px;

    &:after {
      content: '';
      vertical-align: middle;
    }

    .ant-tag {
      cursor: pointer;
      margin-right: 0;
      vertical-align: middle;
      + .ant-tag {
        margin-left: 4px;
      }
    }
  }
`;

interface Props {
  sql: string;
  references: Reference[];
  targetReference?: Reference;
  onHighlightHover?: (reference: Reference) => void;
}

const optimizedSnippet = (snippet: string) => {
  // SQL analysis may add more spaces and add brackets to the sql, so we need to handle it.
  return snippet
    .replace(/\(/g, '\\(?')
    .replace(/\)/g, '\\)?')
    .replace(/\s/g, '\\s*');
};

const createSnippetsRegex = (snippets: string[]) => {
  return new RegExp(`(${snippets.join('|')})`, 'gi');
};

const _printUnmatchedReferences = (
  references: Reference[],
  referenceMatches,
) => {
  // For debugging purpose
  const unmatchedReferences = references.filter(
    (reference) => !referenceMatches.flat().includes(reference),
  );
  if (unmatchedReferences.length > 0)
    console.warn('Unmatched references:', unmatchedReferences);
};

export default function SQLHighlight(props: Props) {
  const { sql, references, targetReference, onHighlightHover } = props;
  const $wrapper = useRef(null);

  useEffect(() => {
    if ($wrapper.current) {
      const $element = $wrapper.current;
      const $targets = $element.querySelectorAll(`.isActive`);
      $targets.forEach((target) => {
        target.classList.remove('isActive');
      });
      if (targetReference) {
        const $target = $wrapper.current.querySelector(
          `.reference-${targetReference.referenceNum}`,
        );
        if (!$target) return;
        $target.classList.add('isActive');
      }
    }
  }, [targetReference]);

  const sqlArray = useMemo(() => sql.split('\n'), [sql]);
  const referenceGroups = useMemo(() => {
    const filteredReferences = references
      .filter((reference) => reference.sqlLocation)
      .map((reference) => ({
        ...reference,
        sqlSnippet: reference.sqlSnippet
          ? optimizedSnippet(reference.sqlSnippet)
          : reference.sqlSnippet,
      }));
    return groupBy(
      filteredReferences,
      (reference) => reference.sqlLocation.line,
    );
  }, [references]);

  const hoverHighlight = (reference?: Reference) => {
    onHighlightHover && onHighlightHover(reference);
  };

  const highlights = [];
  const referenceMatches = [];
  const tokenize = getTokenizer();
  Object.keys(referenceGroups).forEach((line) => {
    const lineIndex = Number(line) - 1;
    const lineReferences = referenceGroups[line];
    const snippets = lineReferences.map((r) => r.sqlSnippet);
    const regex = createSnippetsRegex(snippets);
    const parts = sqlArray[lineIndex].split(regex);

    // Add to highlights if the part is matched
    highlights[lineIndex] = parts.map((part, index) => {
      const tokens = tokenize(part);
      const tokenizedPart = tokens.map((token, tokenIndex) => {
        const classNames = token.type.split('.').map((name) => `ace_${name}`);
        return (
          <span key={tokenIndex} className={classNames.join(' ')}>
            {token.value}
          </span>
        );
      });
      if (regex.test(part)) {
        const matchedReferences = lineReferences.filter((reference) =>
          new RegExp(reference.sqlSnippet, 'i').test(part),
        );
        const tags = matchedReferences.map((reference) => {
          return (
            <Tag
              className={clsx('ant-tag__reference')}
              key={reference.referenceNum}
            >
              <span className="mr-1 lh-xs">
                {getReferenceIcon(reference.type)}
              </span>
              {reference.referenceNum}
            </Tag>
          );
        });
        // Record the matched references
        referenceMatches.push(matchedReferences);
        const reference = matchedReferences[0];
        return (
          <span
            className={clsx(
              'sqlHighlight__block',
              `reference-${reference.referenceNum}`,
            )}
            onMouseEnter={() => hoverHighlight(reference)}
            onMouseLeave={() => hoverHighlight()}
            key={index}
          >
            <mark>{tokenizedPart}</mark>
            {tags && <span className="sqlHighlight__tags">{tags}</span>}
          </span>
        );
      }
      return <span key={index}>{tokenizedPart}</span>;
    });
  });

  const content = sqlArray.map((_, index) => {
    if (highlights[index]) {
      return (
        <div className="sqlHighlight__line" key={index}>
          {highlights[index]}
        </div>
      );
    }
    return (
      <div key={index} style={{ background: 'transparent' }}>
        &nbsp;
      </div>
    );
  });

  // For debugging purpose
  // _printUnmatchedReferences(references, referenceMatches);

  return <SQLWrapper ref={$wrapper}>{content}</SQLWrapper>;
}
