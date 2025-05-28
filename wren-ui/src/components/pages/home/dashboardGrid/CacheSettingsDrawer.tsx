import { useEffect } from 'react';
import { capitalize } from 'lodash';
import { CronExpressionParser } from 'cron-parser';
import moment from 'moment';
import {
  Button,
  Drawer,
  Form,
  Space,
  Switch,
  Select,
  Input,
  Row,
  Col,
  Divider,
  TimePicker,
} from 'antd';
import { browserTimeZone } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import { ERROR_TEXTS } from '@/utils/error';
import { isValidCronLength, cronValidator } from '@/utils/validator';
import { CacheScheduleDayEnum } from '@/apollo/client/graphql/__types__';

type Props = DrawerAction & {
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
      [CacheScheduleDayEnum.MON]: 'Monday',
      [CacheScheduleDayEnum.TUE]: 'Tuesday',
      [CacheScheduleDayEnum.WED]: 'Wednesday',
      [CacheScheduleDayEnum.THU]: 'Thursday',
      [CacheScheduleDayEnum.FRI]: 'Friday',
      [CacheScheduleDayEnum.SAT]: 'Saturday',
      [CacheScheduleDayEnum.SUN]: 'Sunday',
    }[day] || ''
  );
};

const getFrequencyText = (frequency: string) => {
  if (frequency === FREQUENCY.NEVER) return 'Manual refresh only';
  return capitalize(frequency);
};

const getInitialSchedule = (frequency: string) => {
  let schedule = {};
  switch (frequency) {
    case FREQUENCY.DAILY:
      schedule = {
        day: null,
        time: moment('00:00', timeFormat),
        cron: null,
      };
      break;
    case FREQUENCY.WEEKLY:
      schedule = {
        day: DAY_OF_WEEK[0],
        time: moment('00:00', timeFormat),
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
    const time = moment(
      `${schedule.hour}:${schedule.minute}`,
      timeFormat,
    ).format(timeFormat);
    return time;
  };

  switch (frequency) {
    case FREQUENCY.DAILY: {
      const time = convertTime(schedule);
      return `Cache refreshes daily at ${time}`;
    }
    case FREQUENCY.WEEKLY: {
      const time = convertTime(schedule);
      return `Cache refreshes every ${getDayOfWeekText(schedule.day as CacheScheduleDayEnum)} at ${time}`;
    }
    case FREQUENCY.CUSTOM: {
      return `Cache refreshes on custom schedule`;
    }
    case FREQUENCY.NEVER: {
      return 'Cache refresh: manual only';
    }
    default: {
      return '';
    }
  }
};

const getNextSchedule = (data: {
  frequency: string;
  day: string;
  time: moment.Moment;
  cron: string;
}) => {
  const { frequency, day, time, cron } = data;
  if (frequency === FREQUENCY.CUSTOM) return getNextScheduleByCron(cron);
  if (frequency === FREQUENCY.NEVER || !time) return null;

  // frequency daily or weekly calculation
  const now = moment();
  const targetTime = moment(
    `${now.format('YYYY-MM-DD')} ${time.format(timeFormat)}`,
  );

  // set the day of the week if it's a weekly schedule
  if (day) {
    const dayIndex = DAY_OF_WEEK.findIndex((d) => d === day);
    targetTime.set({ day: dayIndex });
  }

  // postpond the time if it's already passed
  if (now.isAfter(targetTime)) {
    if (frequency === FREQUENCY.DAILY) {
      targetTime.add(1, 'd');
    } else if (frequency === FREQUENCY.WEEKLY) {
      targetTime.add(7, 'd');
    }
  }

  return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
};

const getNextScheduleByCron = (cron: string) => {
  if (!cron || !isValidCronLength(cron)) return null;
  try {
    const interval = CronExpressionParser.parse(cron, { tz: 'UTC' });
    const targetTime = moment.utc(interval.next().toDate()).local();
    return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export default function CacheSettingsDrawer(props: Props) {
  const { visible, defaultValue, loading, onClose, onSubmit } = props;
  const [form] = Form.useForm();

  const cacheEnabled = Form.useWatch('cacheEnabled', form);

  useEffect(() => {
    if (visible) {
      const { schedule, ...restValues } = defaultValue || {};
      form.setFieldsValue({
        ...restValues,
        schedule: {
          day: schedule?.day,
          frequency: schedule?.frequency,
          time:
            schedule?.hour.toString() && schedule?.minute.toString()
              ? moment(`${schedule?.hour}:${schedule?.minute}`, timeFormat)
              : null,
          cron: schedule?.cron,
        },
      });
    }
  }, [visible, defaultValue]);

  const afterVisibleChange = (visible: boolean) => {
    if (!visible) {
      form.resetFields();
    }
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
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
      .catch(console.error);
  };

  return (
    <Drawer
      visible={visible}
      title="Cache settings"
      width={410}
      closable
      destroyOnClose
      maskClosable={false}
      afterVisibleChange={afterVisibleChange}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={loading}
            disabled={loading}
          >
            Submit
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="Enable caching"
          name="cacheEnabled"
          valuePropName="checked"
          extra="Enable caching to speed up dashboard loading by reusing recent results. Choose a refresh schedule that fits your needs below."
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
      <Divider className="gray-6 text-sm">Refresh settings</Divider>
      <Form.Item label="Frequency" name={['schedule', 'frequency']}>
        <Select
          placeholder="Select frequency"
          options={Object.keys(FREQUENCY).map((key) => ({
            label: getFrequencyText(key),
            value: FREQUENCY[key],
          }))}
          onChange={onFrequencyChange}
        />
      </Form.Item>

      {frequency === FREQUENCY.DAILY && <DailyTimeSelection />}
      {frequency === FREQUENCY.WEEKLY && <WeeklyTimeSelection />}
      {frequency === FREQUENCY.CUSTOM && (
        <Form.Item
          label="Cron expression"
          name={['schedule', 'cron']}
          required={false}
          rules={[{ validator: cronValidator }]}
          extra="Cron expression will be executed in UTC timezone (e.g. '0 0 * * *' for daily at midnight UTC)"
        >
          <Input style={{ maxWidth: 200 }} placeholder="* * * * *" />
        </Form.Item>
      )}

      {nextSchedule && (
        <div className="gray-7">
          Next scheduled refresh:
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
        label="Time"
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
            label="Day"
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
              placeholder="Select day"
            />
          </Form.Item>
        </Col>
        <Col>
          <Form.Item
            label="Time"
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
