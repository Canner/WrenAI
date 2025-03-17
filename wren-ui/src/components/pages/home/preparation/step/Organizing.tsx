import { Typography } from 'antd';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import { Loading } from '@/components/PageLoading';

interface Props {
  stream: string;
  loading?: boolean;
}

export default function Organizing(props: Props) {
  const $wrapper = useRef<HTMLDivElement>(null);
  const { stream, loading } = props;

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

  return (
    <>
      <Typography.Text className="gray-8">Organizing thoughts</Typography.Text>
      <div
        ref={$wrapper}
        className="gray-7 text-sm mt-2"
        style={{ maxHeight: 'calc(100vh - 550px)', overflowY: 'auto' }}
      >
        {loading ? (
          <div className="d-flex align-center gx-2">
            Thinking
            <Loading className="gray-6" size={12} loading />
          </div>
        ) : (
          <MarkdownBlock content={stream} />
        )}
      </div>
    </>
  );
}
