import { COLUMN } from '@/components/table/BaseTable';
import { makeTableFormControl } from './base';
import AddDimensionFieldModal, {
  DimensionFieldValue,
} from '@/components/modals/AddDimensionFieldModal';

export type DimensionTableValue = DimensionFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddDimensionFieldModal);

export default function DimensionTableFormControl(props: Props) {
  return (
    <TableFormControl
      {...props}
      columns={[COLUMN.DISPLAY_NAME, COLUMN.REFERENCE_NAME, COLUMN.DESCRIPTION]}
    />
  );
}
