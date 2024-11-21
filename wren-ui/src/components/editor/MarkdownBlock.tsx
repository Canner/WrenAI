import styled from 'styled-components';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ReactMarkdownBlock = styled(ReactMarkdown)`
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: var(--gray-10);
    margin-bottom: 8px;
  }
  h1 {
    font-size: 20px;
  }
  h2 {
    font-size: 18px;
  }
  h3 {
    font-size: 16px;
  }
  h4 {
    font-size: 14px;
  }
  hr {
    border-top: 1px solid var(--gray-5);
    border-bottom: none;
    border-left: none;
    border-right: none;
    margin: 18px 0;
  }
  pre {
    background-color: var(--gray-2);
    border: 1px var(--gray-4) solid;
    padding: 16px;
    border-radius: 4px;
  }
  table td,
  table th {
    border: 1px solid var(--gray-4);
    padding: 4px 8px;
  }
  table th {
    background-color: var(--gray-2);
    font-weight: 600;
  }
  table {
    border: 1px solid var(--gray-4);
    border-collapse: collapse;
    margin-bottom: 16px;
  }
`;

export default function MarkdownBlock(props: { content: string }) {
  return (
    <ReactMarkdownBlock remarkPlugins={[remarkGfm]}>
      {props.content}
    </ReactMarkdownBlock>
  );
}
