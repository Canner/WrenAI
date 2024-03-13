import { useMemo } from 'react';
import { makeTableFormControl } from './base';
import AddDimensionFieldModal, {
  DimensionFieldValue,
} from '@/components/modals/AddDimensionFieldModal';
import { getDimensionFieldTableColumns } from '@/components/table/DimensionFieldTable';

export type DimensionTableValue = DimensionFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddDimensionFieldModal);

export default function DimensionTableFormControl(props: Props) {
  const columns = useMemo(getDimensionFieldTableColumns, [props.value]);
  return <TableFormControl {...props} columns={columns} />;
}
