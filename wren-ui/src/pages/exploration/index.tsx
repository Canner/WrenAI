import { useRouter } from 'next/router';
import { Button } from 'antd';
import { Path } from '@/utils/enum';
import { ExploreIcon } from '@/utils/icons';
import SiderLayout from '@/components/layouts/SiderLayout';
import SelectDataToExploreModal from '@/components/pages/explore/SelectDataToExploreModal';
import Background from '@/components/Background';
import useModalAction from '@/hooks/useModalAction';

export default function Exploration() {
  const selectDataToExploreModal = useModalAction();
  const router = useRouter();

  // TODO: call API to get real exploration list data
  const data = [
    {
      id: 'id-1',
      name: 'global customer',
    },
    {
      id: 'id-2',
      name: 'customer order amount exceeding 5000 ',
    },
  ];

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Exploration}/${selectKeys[0]}`);
  };

  return (
    <SiderLayout loading={false} sidebar={{ data, onSelect }}>
      <Background />

      <div
        className="d-flex align-center justify-center"
        style={{ height: '100%' }}
      >
        <Button
          icon={<ExploreIcon className="mr-2" />}
          onClick={() => selectDataToExploreModal.openModal()}
        >
          Start from modeling
        </Button>
      </div>

      <SelectDataToExploreModal
        {...selectDataToExploreModal.state}
        onClose={selectDataToExploreModal.closeModal}
      />
    </SiderLayout>
  );
}
