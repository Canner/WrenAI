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
} from 'antd';
import { CacheScheduleDayEnum } from '@/types/home';
import { browserTimeZone } from '@/utils/time';
import type { DrawerAction } from '@/hooks/useDrawerAction';
import { ERROR_TEXTS } from '@/utils/error';
import { handleFormSubmitError } from '@/utils/errorHandler';
import { isValidCronLength, cronValidator } from '@/utils/validator';

dayjs.extend(customParseFormat);
dayjs.extend(utc);

type Props = Omit<DrawerAction, 'visible'> & {
  visible?: boolean;
  open?: boolean;
  loading?: boolean;
};
export interface Schedule {
  frequency: string;
  day?: string;
  hour?: number;
  minute?: number;
  cron?: string;
  timezone?: string;
}

const timeFormat = 'HH:mm';

const FREQUENCY = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  CUSTOM: 'CUSTOM',
  NEVER: 'NEVER',
};

// This sequence follows the first day of the week
const DAY_OF_WEEK = [
  CacheScheduleDayEnum.SUN,
  CacheScheduleDayEnum.MON,
  CacheScheduleDayEnum.TUE,
  CacheScheduleDayEnum.WED,
  CacheScheduleDayEnum.THU,
  CacheScheduleDayEnum.FRI,
  CacheScheduleDayEnum.SAT,
];

const getDayOfWeekText = (day: CacheScheduleDayEnum) => {
  return (
    {
      [CacheScheduleDayEnum.MON]: '周一',
      [CacheScheduleDayEnum.TUE]: '周二',
      [CacheScheduleDayEnum.WED]: '周三',
      [CacheScheduleDayEnum.THU]: '周四',
      [CacheScheduleDayEnum.FRI]: '周五',
      [CacheScheduleDayEnum.SAT]: '周六',
      [CacheScheduleDayEnum.SUN]: '周日',
    }[day] || ''
  );
};

const getFrequencyText = (frequency: string) => {
  if (frequency === FREQUENCY.NEVER) return '仅手动刷新';
  return (
    {
      [FREQUENCY.DAILY]: '每天',
      [FREQUENCY.WEEKLY]: '每周',
      [FREQUENCY.CUSTOM]: '自定义',
    }[frequency] || capitalize(frequency)
  );
};

const getInitialSchedule = (frequency: string) => {
  let schedule = {};
  switch (frequency) {
    case FREQUENCY.DAILY:
      schedule = {
        day: null,
        time: dayjs('00:00', timeFormat),
        cron: null,
      };
      break;
    case FREQUENCY.WEEKLY:
      schedule = {
        day: DAY_OF_WEEK[0],
        time: dayjs('00:00', timeFormat),
        cron: null,
      };
      break;
    case FREQUENCY.CUSTOM:
      schedule = {
        day: null,
        time: null,
        cron: '0 0 * * *',
      };
      break;
    case FREQUENCY.NEVER:
      schedule = {
        day: null,
        time: null,
        cron: null,
      };
      break;
    default:
      break;
  }
  return schedule;
};

export const getScheduleText = (schedule: Schedule): string => {
  if (!schedule) return '';
  const { frequency } = schedule;

  const convertTime = (schedule: Schedule) => {
    const time = dayjs(
      `${schedule.hour}:${schedule.minute}`,
      timeFormat,
    ).format(timeFormat);
    return time;
  };

  switch (frequency) {
    case FREQUENCY.DAILY: {
      const time = convertTime(schedule);
      return `缓存每天 ${time} 自动刷新`;
    }
    case FREQUENCY.WEEKLY: {
      const time = convertTime(schedule);
      return `缓存每周${getDayOfWeekText(schedule.day as CacheScheduleDayEnum)} ${time} 自动刷新`;
    }
    case FREQUENCY.CUSTOM: {
      return '缓存按自定义计划刷新';
    }
    case FREQUENCY.NEVER: {
      return '缓存仅支持手动刷新';
    }
    default: {
      return '';
    }
  }
};

const getNextSchedule = (data: {
  frequency: string;
  day: string;
  time: Dayjs | null;
  cron: string;
}) => {
  const { frequency, day, time, cron } = data;
  if (frequency === FREQUENCY.CUSTOM) return getNextScheduleByCron(cron);
  if (frequency === FREQUENCY.NEVER || !time) return null;

  // frequency daily or weekly calculation
  const now = dayjs();
  let targetTime = dayjs(
    `${now.format('YYYY-MM-DD')} ${time.format(timeFormat)}`,
    'YYYY-MM-DD HH:mm',
  );

  // set the day of the week if it's a weekly schedule
  if (day) {
    const dayIndex = DAY_OF_WEEK.findIndex((d) => d === day);
    const dayOffset = (dayIndex - targetTime.day() + 7) % 7;
    targetTime = targetTime.add(dayOffset, 'day');
  }

  // postpone the time if it's already passed
  if (now.isAfter(targetTime)) {
    if (frequency === FREQUENCY.DAILY) {
      targetTime = targetTime.add(1, 'day');
    } else if (frequency === FREQUENCY.WEEKLY) {
      targetTime = targetTime.add(7, 'day');
    }
  }

  return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
};

const getNextScheduleByCron = (cron: string) => {
  if (!cron || !isValidCronLength(cron)) return null;
  try {
    const interval = CronExpressionParser.parse(cron, { tz: 'UTC' });
    const targetTime = dayjs.utc(interval.next().toDate()).local();
    return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export default function CacheSettingsDrawer(props: Props) {
  const { visible, open, defaultValue, loading, onClose, onSubmit } = props;
  const drawerOpen = open ?? visible;
  const [form] = Form.useForm();

  const cacheEnabled = Form.useWatch('cacheEnabled', form);

  useEffect(() => {
    if (drawerOpen) {
      const { schedule, ...restValues } = defaultValue || {};
      form.setFieldsValue({
        ...restValues,
        schedule: {
          day: schedule?.day,
          frequency: schedule?.frequency,
          time:
            schedule?.hour != null && schedule?.minute != null
              ? dayjs(`${schedule?.hour}:${schedule?.minute}`, timeFormat)
              : null,
          cron: schedule?.cron,
        },
      });
    }
  }, [drawerOpen, defaultValue]);

  const afterOpenChange = (open: boolean) => {
    if (!open) {
      form.resetFields();
    }
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        if (!onSubmit) {
          return;
        }
        const { schedule } = values;
        await onSubmit({
          ...values,
          schedule: values.cacheEnabled
            ? {
                frequency: schedule?.frequency,
                day: schedule?.day,
                hour: schedule?.time?.hour(),
                minute: schedule?.time?.minute(),
                cron: schedule?.cron,
                timezone: browserTimeZone,
              }
            : null,
        });
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '保存缓存设置失败，请稍后重试。');
      });
  };

  return (
    <Drawer
      open={drawerOpen}
      title="缓存设置"
      width={410}
      closable
      destroyOnHidden
      maskClosable={false}
      afterOpenChange={afterOpenChange}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={loading}
            disabled={loading}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="启用缓存"
          name="cacheEnabled"
          valuePropName="checked"
          extra="启用缓存后会复用最近一次结果，加快仪表板加载速度。你可以在下方配置合适的刷新计划。"
        >
          <Switch />
        </Form.Item>
        {cacheEnabled && <Schedule />}
      </Form>
    </Drawer>
  );
}

function Schedule() {
  const form = Form.useFormInstance();
  const frequency = Form.useWatch(['schedule', 'frequency'], form);
  const day = Form.useWatch(['schedule', 'day'], form);
  const time = Form.useWatch(['schedule', 'time'], form);
  const cron = Form.useWatch(['schedule', 'cron'], form);

  const onFrequencyChange = (value: string) => {
    form.setFieldsValue({
      schedule: { frequency: value, ...getInitialSchedule(value) },
    });
  };

  const nextSchedule = getNextSchedule({ frequency, day, time, cron });

  return (
    <>
      <Divider className="gray-6 text-sm">刷新计划</Divider>
      <Form.Item label="刷新频率" name={['schedule', 'frequency']}>
        <Select
          placeholder="选择刷新频率"
          options={Object.values(FREQUENCY).map((frequencyValue) => ({
            label: getFrequencyText(frequencyValue),
            value: frequencyValue,
          }))}
          onChange={onFrequencyChange}
        />
      </Form.Item>

      {frequency === FREQUENCY.DAILY && <DailyTimeSelection />}
      {frequency === FREQUENCY.WEEKLY && <WeeklyTimeSelection />}
      {frequency === FREQUENCY.CUSTOM && (
        <Form.Item
          label="Cron 表达式"
          name={['schedule', 'cron']}
          required={false}
          rules={[{ validator: cronValidator }]}
          extra="Cron 表达式会按 UTC 时区执行，例如 `0 0 * * *` 表示每天 UTC 零点刷新。"
        >
          <Input style={{ maxWidth: 200 }} placeholder="* * * * *" />
        </Form.Item>
      )}

      {nextSchedule && (
        <div className="gray-7">
          下次计划刷新时间：
          <div className="gray-8">
            {nextSchedule} {browserTimeZone && <span>({browserTimeZone})</span>}
          </div>
        </div>
      )}
    </>
  );
}

function DailyTimeSelection() {
  return (
    <>
      <Form.Item
        label="时间"
        name={['schedule', 'time']}
        required={false}
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CACHE_SETTINGS.TIME.REQUIRED,
          },
        ]}
      >
        <TimePicker minuteStep={10} format={timeFormat} />
      </Form.Item>
    </>
  );
}

function WeeklyTimeSelection() {
  return (
    <>
      <Row gutter={16}>
        <Col>
          <Form.Item
            label="日期"
            name={['schedule', 'day']}
            required={false}
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CACHE_SETTINGS.DAY.REQUIRED,
              },
            ]}
          >
            <Select
              style={{ minWidth: 123 }}
              options={DAY_OF_WEEK.map((value) => ({
                label: getDayOfWeekText(value),
                value,
              }))}
              placeholder="选择日期"
            />
          </Form.Item>
        </Col>
        <Col>
          <Form.Item
            label="时间"
            name={['schedule', 'time']}
            required={false}
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
    </>
  );
}
