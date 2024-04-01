import { useState } from 'react';
import { SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import {
  useListDataSourceTablesQuery,
  useSaveTablesMutation,
} from '@/apollo/client/graphql/dataSource.generated';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);

  const router = useRouter();

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    onError: (error) => console.error(error),
  });

  const [saveTablesMutation, { loading: submitting }] = useSaveTablesMutation();

  const submitModels = async (tables: string[]) => {
    await saveTablesMutation({
      variables: {
        data: { tables },
      },
    });
    router.push('/setup/relations');
  };

  const onBack = () => {
    router.push('/setup/connection');
  };

  const onNext = (data: { selectedTables: string[] }) => {
    submitModels(data.selectedTables);
  };

  return {
    submitting,
    fetching,
    stepKey,
    onBack,
    onNext,
    tables: data?.listDataSourceTables || [],
  };
}
