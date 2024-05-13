import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Input, InputRef, Form, FormInstance } from 'antd';
import styled from 'styled-components';
import { get } from 'lodash';
import EllipsisWrapper from '@/components/EllipsisWrapper';

interface Props {
  children: React.ReactNode;
  dataIndex: string;
  record: any;
  rules?: any[];
  handleSave: (id: string, value: { [key: string]: string }) => void;
}

const EditableStyle = styled.div`
  line-height: 24px;
  min-height: 25px;

  .editable-cell-value-wrap {
    padding: 0 7px;
    border: 1px var(--gray-4) solid;
    border-radius: 4px;
    cursor: pointer;

    &:hover {
      border-color: var(--gray-5);
    }
  }
  .ant-form-item-control-input {
    min-height: 24px;
    .ant-input {
      line-height: 24px;
    }
  }
`;

export const EditableContext = createContext<FormInstance<any> | null>(null);

export default function EditableWrapper(props: Props) {
  const { children, dataIndex, record, rules, handleSave } = props;

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<InputRef>(null);
  const form = useContext(EditableContext);
  const dataIndexKey = Array.isArray(dataIndex)
    ? dataIndex.join('.')
    : dataIndex;

  useEffect(() => {
    if (editing) inputRef.current!.focus();
  }, [editing]);

  const toggleEdit = () => {
    setEditing(!editing);
    const value = get(record, dataIndexKey);
    form.setFieldsValue({ [dataIndexKey]: value });
  };

  const save = async () => {
    try {
      const values = await form.validateFields();

      toggleEdit();
      handleSave(record.id, values);
    } catch (errInfo) {
      console.log('Save failed:', errInfo);
    }
  };

  const childNode = editing ? (
    <Form.Item style={{ margin: 0 }} name={dataIndexKey} rules={rules}>
      <Input size="small" ref={inputRef} onPressEnter={save} onBlur={save} />
    </Form.Item>
  ) : (
    <div
      className="editable-cell-value-wrap"
      style={{ paddingRight: 24 }}
      onClick={toggleEdit}
    >
      <EllipsisWrapper text={children as string} />
    </div>
  );

  return <EditableStyle>{childNode}</EditableStyle>;
}
