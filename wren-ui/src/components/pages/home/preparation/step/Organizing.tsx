import { useEffect, useRef } from 'react';
import { Typography } from 'antd';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import { Spinner } from '@/components/PageLoading';

interface Props {
  stream: string;
  loading?: boolean;
  isAdjustment?: boolean;
}

export default function Organizing(props: Props) {
  const $wrapper = useRef<HTMLDivElement>(null);
  const { stream, loading, isAdjustment } = props;

  const isDone = stream && !loading;

  const scrollBottom = () => {
    if ($wrapper.current) {
      $wrapper.current.scrollTo({
        top: $wrapper.current.scrollHeight,
      });
    }
  };

  useEffect(() => {
    scrollBottom();
  }, [stream]);

  useEffect(() => {
    if (isDone) scrollBottom();
  }, [isDone]);

  const title = isAdjustment
    ? 'User-provided reasoning steps applied'
    : 'Organizing thoughts';

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div
        ref={$wrapper}
        className="gray-7 text-sm mt-2"
        style={{ maxHeight: 'calc(100vh - 550px)', overflowY: 'auto' }}
      >
        {loading && !stream ? (
          <div className="d-flex align-center gx-2">
            Thinking
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <MarkdownBlock content={stream} />
        )}
      </div>
    </>
  );
}
