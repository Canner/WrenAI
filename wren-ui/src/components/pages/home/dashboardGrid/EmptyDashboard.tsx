import Link from 'next/link';
import Image from 'next/image';
import { Row, Col } from 'antd';
import { Logo } from '@/components/Logo';
import { makeIterable } from '@/utils/iteration';

const StepTemplate = (props: { title: string; image: string }) => {
  return (
    <Col>
      <div
        className="p-3 rounded bg-gray-1 border border-gray-5"
        style={{ boxShadow: '2px 2px 2px 0px #00000006' }}
      >
        <div className="mb-2">
          <span
            className="d-inline-block bg-geekblue-1 geekblue-6 rounded-pill text-sm px-2"
            style={{ lineHeight: '22px' }}
          >
            {props.title}
          </span>
        </div>
        <Image
          className="rounded border border-gray-4"
          src={props.image}
          width={160}
          height={80}
          alt={props.title}
        />
      </div>
    </Col>
  );
};

const StepIterator = makeIterable(StepTemplate);

const EmptyDashboard = (props: {
  show: boolean;
  children: React.ReactNode;
}) => {
  const { show, children } = props;
  if (show) {
    return (
      <div
        className="d-flex align-center justify-center flex-column -mt-8"
        style={{ height: '100%' }}
      >
        <Logo size={48} color="var(--gray-8)" />
        <div className="text-lg text-medium text-center gray-8 mt-3">
          No charts have been added yet
        </div>
        <div className="gray-7">
          Follow these steps to pin charts to your dashboard.{' '}
          <Link
            className="gray-8 underline"
            href="https://docs.getwren.ai/oss/guide/home/dashboard"
            rel="noopener noreferrer"
            target="_blank"
          >
            Learn more
          </Link>
        </div>
        <Row className="mt-4" gutter={[16, 16]}>
          <StepIterator
            data={[
              {
                title: '1. Create a thread',
                image: '/images/dashboard/s1.jpg',
              },
              {
                title: '2. Generate a chart',
                image: '/images/dashboard/s2.jpg',
              },
              {
                title: '3. Pin to dashboard',
                image: '/images/dashboard/s3.jpg',
              },
            ]}
          />
        </Row>
      </div>
    );
  }
  return <>{children}</>;
};

export default EmptyDashboard;
