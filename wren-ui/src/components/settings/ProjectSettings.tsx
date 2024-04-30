import { Button, Modal } from 'antd';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { useResetCurrentProjectMutation } from '@/apollo/client/graphql/settings.generated';

export default function ProjectSettings() {
  const router = useRouter();
  const [resetCurrentProject, { client }] = useResetCurrentProjectMutation();

  const reset = () => {
    Modal.confirm({
      title: 'Are you sure you want to reset?',
      okButtonProps: { danger: true },
      okText: 'Reset',
      onOk: async () => {
        await resetCurrentProject();
        client.clearStore();
        router.push(Path.OnboardingConnection);
      },
    });
  };

  return (
    <div className="py-3 px-4">
      <div className="gray-8 mb-2">Reset project</div>
      <Button type="primary" style={{ width: 70 }} danger onClick={reset}>
        Reset
      </Button>
      <div className="gray-6 mt-1">
        Please be aware that resetting will delete all current settings and
        records, including those in the Modeling Page and Home Page threads.
      </div>
    </div>
  );
}
