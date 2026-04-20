import { useContext } from 'react';
import { FormItemInputContext } from 'antd/lib/form/context';

/**
 * Antd 4 compatibility shim.
 *
 * Wren UI still relies on Form.Item status styling for several custom inputs,
 * but Antd 4.20.4 does not expose a public hook for reading that status.
 * Centralizing the private-context access here keeps the remaining Antd-private
 * surface in one place while Batch 0 continues shrinking direct internal
 * imports elsewhere.
 */
export default function useAntdFormItemStatus() {
  const formItemContext = useContext(FormItemInputContext);
  return formItemContext?.status as string | undefined;
}
