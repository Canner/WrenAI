import { COLUMN } from '@/components/table/BaseTable';
import { makeTableFormControl } from './base';
import AddWindowFieldModal, {
  WindowFieldValue,
} from '@/components/modals/AddWindowFieldModal';

export type WindowTableValue = WindowFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddWindowFieldModal);

export default function WindowTableFormControl(props: Props) {
  return (
    <TableFormControl
      {...props}
      columns={[COLUMN.DISPLAY_NAME, COLUMN.REFERENCE_NAME, COLUMN.DESCRIPTION]}
    />
  );
}
