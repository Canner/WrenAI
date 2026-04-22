import { useEffect } from 'react';
import { capitalize } from 'lodash';
import { CronExpressionParser } from 'cron-parser';
import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import {
  Button,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  TimePicker,
  Typography,
} from 'antd';
import { CacheScheduleDayEnum } from '@/types/home';
import { browserTimeZone } from '@/utils/time';
import { ERROR_TEXTS } from '@/utils/error';
import { cronValidator, isValidCronLength } from '@/utils/validator';
import type { ScheduleConfig } from '@/features/settings/systemTasks/systemTasksPageUtils';

dayjs.extend(customParseFormat);
dayjs.extend(utc);

const { Text } = Typography;

type DrawerFormValue = {
  cacheEnabled: boolean;
  schedule: {
    day?: string | null;
    frequency?: string;
    time?: Dayjs | null;
    cron?: string | null;
  };
};

type Props = {
  open: boolean;
  loading?: boolean;
  defaultValue?: {
    cacheEnabled: boolean;
    schedule: ScheduleConfig | null;
  } | null;
  onClose: () => void;
  onSubmit: (values: {
    cacheEnabled: boolean;
    schedule: ScheduleConfig | null;
  }) => Promise<void> | void;
};

const timeFormat = 'HH:mm';

const FREQUENCY = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  CUSTOM: 'CUSTOM',
  NEVER: 'NEVER',
} as const;

const DAY_OF_WEEK = [
  CacheScheduleDayEnum.SUN,
  CacheScheduleDayEnum.MON,
  CacheScheduleDayEnum.TUE,
  CacheScheduleDayEnum.WED,
  CacheScheduleDayEnum.THU,
  CacheScheduleDayEnum.FRI,
  CacheScheduleDayEnum.SAT,
];

const DAY_LABELS = {
  [CacheScheduleDayEnum.MON]: '周一',
  [CacheScheduleDayEnum.TUE]: '周二',
  [CacheScheduleDayEnum.WED]: '周三',
  [CacheScheduleDayEnum.THU]: '周四',
  [CacheScheduleDayEnum.FRI]: '周五',
  [CacheScheduleDayEnum.SAT]: '周六',
  [CacheScheduleDayEnum.SUN]: '周日',
} as const;

const getDayOfWeekText = (day: CacheScheduleDayEnum) => DAY_LABELS[day] || '';

const getFrequencyText = (frequency: string) => {
  if (frequency === FREQUENCY.NEVER) {
    return '仅手动刷新';
  }

  return (
    {
      [FREQUENCY.DAILY]: '每天',
      [FREQUENCY.WEEKLY]: '每周',
      [FREQUENCY.CUSTOM]: '自定义',
    }[frequency] || capitalize(frequency)
  );
};

const getInitialSchedule = (frequency: string) => {
  switch (frequency) {
    case FREQUENCY.DAILY:
      return {
        day: null,
        time: dayjs('00:00', timeFormat),
        cron: null,
      };
    case FREQUENCY.WEEKLY:
      return {
        day: DAY_OF_WEEK[0],
        time: dayjs('00:00', timeFormat),
        cron: null,
      };
    case FREQUENCY.CUSTOM:
      return {
        day: null,
        time: null,
        cron: '0 0 * * *',
      };
    case FREQUENCY.NEVER:
    default:
      return {
        day: null,
        time: null,
        cron: null,
      };
  }
};

const getNextScheduleByCron = (cron?: string | null) => {
  if (!cron || !isValidCronLength(cron)) {
    return null;
  }

  try {
    const interval = CronExpressionParser.parse(cron, { tz: 'UTC' });
    const targetTime = dayjs.utc(interval.next().toDate()).local();
    return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
  } catch {
    return null;
  }
};

const getNextSchedule = ({
  frequency,
  day,
  time,
  cron,
}: {
  frequency?: string;
  day?: string | null;
  time?: Dayjs | null;
  cron?: string | null;
}) => {
  if (frequency === FREQUENCY.CUSTOM) {
    return getNextScheduleByCron(cron);
  }

  if (frequency === FREQUENCY.NEVER || !time) {
    return null;
  }

  const now = dayjs();
  let targetTime = dayjs(
    `${now.format('YYYY-MM-DD')} ${time.format(timeFormat)}`,
    'YYYY-MM-DD HH:mm',
  );

  if (day) {
    const dayIndex = DAY_OF_WEEK.findIndex((item) => item === day);
    const dayOffset = (dayIndex - targetTime.day() + 7) % 7;
    targetTime = targetTime.add(dayOffset, 'day');
  }

  if (now.isAfter(targetTime)) {
    targetTime =
      frequency === FREQUENCY.DAILY
        ? targetTime.add(1, 'day')
        : targetTime.add(7, 'day');
  }

  return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
};

export default function SystemTaskScheduleDrawer({
  open,
  loading,
  defaultValue,
  onClose,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<DrawerFormValue>();
  const cacheEnabled = Form.useWatch('cacheEnabled', form);

  useEffect(() => {
    if (!open) {
      return;
    }

    form.setFieldsValue({
      cacheEnabled: defaultValue?.cacheEnabled ?? true,
      schedule: {
        day: defaultValue?.schedule?.day ?? null,
        frequency: defaultValue?.schedule?.frequency ?? FREQUENCY.NEVER,
        time:
          defaultValue?.schedule?.hour != null &&
          defaultValue?.schedule?.minute != null
            ? dayjs(
                `${defaultValue.schedule.hour}:${defaultValue.schedule.minute}`,
                timeFormat,
              )
            : null,
        cron: defaultValue?.schedule?.cron ?? null,
      },
    });
  }, [defaultValue, form, open]);

  const afterOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.resetFields();
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const schedule = values.schedule;

    await onSubmit({
      cacheEnabled: values.cacheEnabled,
      schedule: values.cacheEnabled
        ? {
            frequency: schedule?.frequency || FREQUENCY.NEVER,
            day: schedule?.day ?? null,
            hour: schedule?.time?.hour() ?? null,
            minute: schedule?.time?.minute() ?? null,
            cron: schedule?.cron ?? null,
            timezone: browserTimeZone,
          }
        : null,
    });
  };

  return (
    <Drawer
      open={open}
      title="编辑计划"
      size="large"
      destroyOnHidden
      mask={{ closable: false }}
      onClose={onClose}
      afterOpenChange={afterOpenChange}
      footer={
        <Row justify="end">
          <Space>
            <Button onClick={onClose} disabled={loading}>
              取消
            </Button>
            <Button
              type="primary"
              onClick={() => void handleSubmit()}
              loading={loading}
            >
              保存
            </Button>
          </Space>
        </Row>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="启用定时刷新"
          name="cacheEnabled"
          valuePropName="checked"
          extra="启用后会按照下方计划自动刷新看板缓存；关闭后仅支持手动刷新。"
        >
          <Switch />
        </Form.Item>

        {cacheEnabled ? <ScheduleFields /> : null}
      </Form>
    </Drawer>
  );
}

function ScheduleFields() {
  const form = Form.useFormInstance<DrawerFormValue>();
  const frequency = Form.useWatch(['schedule', 'frequency'], form);
  const day = Form.useWatch(['schedule', 'day'], form);
  const time = Form.useWatch(['schedule', 'time'], form);
  const cron = Form.useWatch(['schedule', 'cron'], form);

  const nextSchedule = getNextSchedule({ frequency, day, time, cron });

  return (
    <>
      <Divider titlePlacement="start">刷新计划</Divider>

      <Form.Item label="刷新频率" name={['schedule', 'frequency']}>
        <Select
          placeholder="选择刷新频率"
          options={Object.values(FREQUENCY).map((value) => ({
            label: getFrequencyText(value),
            value,
          }))}
          onChange={(value) => {
            form.setFieldsValue({
              schedule: {
                frequency: value,
                ...getInitialSchedule(value),
              },
            });
          }}
        />
      </Form.Item>

      {frequency === FREQUENCY.DAILY ? <DailyTimeSelection /> : null}
      {frequency === FREQUENCY.WEEKLY ? <WeeklyTimeSelection /> : null}
      {frequency === FREQUENCY.CUSTOM ? (
        <Form.Item
          label="Cron 表达式"
          name={['schedule', 'cron']}
          rules={[{ validator: cronValidator }]}
          extra="按 UTC 时区执行，例如 `0 0 * * *` 表示每天 UTC 零点刷新。"
        >
          <Input placeholder="* * * * *" />
        </Form.Item>
      ) : null}

      {nextSchedule ? (
        <Text type="secondary">
          下次计划刷新时间：{nextSchedule}
          {browserTimeZone ? ` (${browserTimeZone})` : ''}
        </Text>
      ) : null}
    </>
  );
}

function DailyTimeSelection() {
  return (
    <Form.Item
      label="时间"
      name={['schedule', 'time']}
      rules={[
        {
          required: true,
          message: ERROR_TEXTS.CACHE_SETTINGS.TIME.REQUIRED,
        },
      ]}
    >
      <TimePicker minuteStep={10} format={timeFormat} />
    </Form.Item>
  );
}

function WeeklyTimeSelection() {
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          label="日期"
          name={['schedule', 'day']}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CACHE_SETTINGS.DAY.REQUIRED,
            },
          ]}
        >
          <Select
            options={DAY_OF_WEEK.map((value) => ({
              label: getDayOfWeekText(value),
              value,
            }))}
            placeholder="选择日期"
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          label="时间"
          name={['schedule', 'time']}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CACHE_SETTINGS.TIME.REQUIRED,
            },
          ]}
        >
          <TimePicker minuteStep={10} format={timeFormat} />
        </Form.Item>
      </Col>
    </Row>
  );
}
