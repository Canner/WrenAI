import { useState } from 'react';
import { SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import { SourceTable } from '@/components/pages/setup/SelectModels';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);

  const router = useRouter();

  const submitModels = async (_tables: SourceTable[]) => {
    // TODO: implement submitModels API
    router.push('/setup/relations');
  };

  const onBack = () => {
    router.push('/setup/connection');
  };

  const onNext = (data?: { selectedTables: string[] }) => {
    const tables = data.selectedTables.map((table) => ({ name: table }));
    submitModels(tables);
  };

  return {
    stepKey,
    tables,
    onBack,
    onNext,
  };
}

// TODO: remove it when connecting to backend
const tables = [
  {
    name: 'orders',
  },
  {
    name: 'customers',
  },
  {
    name: 'products',
  },
];
