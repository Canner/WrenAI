import Link from 'next/link';
import { Col, Form, Input, Button, Row } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';

const { TextArea } = Input;

export default function DuckDBProperties() {
  return (
    <>
      <Form.Item
        label="显示名称"
        name="displayName"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input placeholder="DuckDB" />
      </Form.Item>
      <Form.Item
        label="初始化 SQL 语句"
        name="initSql"
        extra="这些 SQL 只会在初始化时执行一次。"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.INIT_SQL.REQUIRED,
          },
        ]}
      >
        <TextArea
          placeholder="CREATE TABLE new_tbl AS SELECT * FROM read_csv('input.csv');"
          rows={4}
        />
      </Form.Item>

      <Form.Item
        label="配置项"
        extra={
          <>
            DuckDB 提供了多种配置项，可用于调整系统行为。{' '}
            <Link
              href="https://duckdb.org/docs/configuration/overview.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              了解更多
            </Link>
          </>
        }
      >
        <Form.List name="configurations" initialValue={[{}]}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Row key={key} wrap={false} gutter={8}>
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      style={{ width: '100%' }}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (
                              getFieldValue(['configurations', name, 'value'])
                            ) {
                              if (!value) {
                                return Promise.reject(
                                  ERROR_TEXTS.CONNECTION.CONFIGURATION.KEY
                                    .REQUIRED,
                                );
                              }
                            }

                            return Promise.resolve();
                          },
                        }),
                      ]}
                    >
                      <Input placeholder="配置键" />
                    </Form.Item>
                  </Col>
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      style={{ width: '100%' }}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (
                              getFieldValue(['configurations', name, 'key'])
                            ) {
                              if (!value) {
                                return Promise.reject(
                                  ERROR_TEXTS.CONNECTION.CONFIGURATION.VALUE
                                    .REQUIRED,
                                );
                              }
                            }

                            return Promise.resolve();
                          },
                        }),
                      ]}
                    >
                      <Input placeholder="配置值" />
                    </Form.Item>
                  </Col>
                  <Col flex="none" className="p-1">
                    <DeleteOutlined onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Form.Item noStyle>
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  添加配置项
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form.Item>
      <Form.Item
        label="扩展"
        extra={
          <>
            DuckDB 支持通过扩展机制动态加载能力。{' '}
            <Link
              href="https://duckdb.org/docs/extensions/overview.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              了解更多
            </Link>
          </>
        }
      >
        <Form.List name="extensions" initialValue={['']}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Row key={key} wrap={false} gutter={8} className="my-2">
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={name}
                      noStyle
                      style={{ width: '100%' }}
                    >
                      <Input placeholder="扩展名称" />
                    </Form.Item>
                  </Col>
                  <Col flex="none" className="p-1">
                    <DeleteOutlined onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Form.Item noStyle>
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  添加扩展
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form.Item>
    </>
  );
}
