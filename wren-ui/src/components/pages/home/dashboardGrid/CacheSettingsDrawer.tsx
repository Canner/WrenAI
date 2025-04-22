import { useEffect } from 'react';
import { capitalize } from 'lodash';
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
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export const getScheduleText = (schedule: Schedule): string => {
  const { frequency } = schedule;

  const convertTime = (schedule: Schedule) => {
    const time = moment(
      `${schedule.hour}:${schedule.minute}`,
      timeFormat,
    ).format('hh:mm a');
    return time;
  };

  switch (frequency) {
    case FREQUENCY.DAILY: {
      const time = convertTime(schedule);
      return `Data refreshed every day at ${time}`;
    }
    case FREQUENCY.WEEKLY: {
      const time = convertTime(schedule);
      return `Data refreshed every ${capitalize(schedule.day.toLowerCase())} at ${time}`;
    }
    case FREQUENCY.CUSTOM: {
      return `Data refreshed according to cron expression ${schedule.cron}`;
    }
    case FREQUENCY.NEVER: {
      return 'Manual refresh only';
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
}) => {
  const { frequency, day, time } = data;
  if (frequency === FREQUENCY.NEVER || !time) return null;

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

const getExtraDescription = (frequency: string) => {
  switch (frequency) {
    case FREQUENCY.DAILY:
    case FREQUENCY.WEEKLY:
      return 'The scheduled refresh time is based on browser timezone.';
    case FREQUENCY.CUSTOM:
      return 'The scheduled refresh time is based on UTC timezone.';
    default:
      return '';
  }
};

export default function CacheSettingsDrawer(props: Props) {
  const { visible, defaultValue, loading, onClose, onSubmit } = props;
  const [form] = Form.useForm();

  const enabled = Form.useWatch('enabled', form);

  useEffect(() => {
    if (visible) {
      const { schedule, ...restValues } = defaultValue || {};
      form.setFieldsValue({
        ...restValues,
        schedule: {
          day: schedule?.day,
          frequency: schedule?.frequency,
          time:
            schedule?.hour && schedule?.minute
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
          schedule: {
            frequency: schedule?.frequency,
            day: schedule?.day,
            hour: schedule?.time?.hour(),
            minute: schedule?.time?.minute(),
            cron: schedule?.cron,
            timezone: browserTimeZone,
          },
        });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Drawer
      visible={visible}
      title="Cache Settings"
      width={410}
      closable
      destroyOnClose
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
        <Form.Item label="Caching" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        {enabled && <Schedule />}
      </Form>
    </Drawer>
  );
}

function Schedule() {
  const form = Form.useFormInstance();
  const frequency = Form.useWatch(['schedule', 'frequency'], form);
  const day = Form.useWatch(['schedule', 'day'], form);
  const time = Form.useWatch(['schedule', 'time'], form);

  const nextSchedule = getNextSchedule({ frequency, day, time });

  return (
    <>
      <Divider className="gray-6 text-sm">Scheduled refresh</Divider>
      <Form.Item
        label="Frequency"
        name={['schedule', 'frequency']}
        extra={getExtraDescription(frequency)}
      >
        <Select
          placeholder="Select frequency"
          options={Object.keys(FREQUENCY).map((key) => ({
            label: capitalize(key),
            value: FREQUENCY[key],
          }))}
        />
      </Form.Item>

      {frequency === FREQUENCY.DAILY && <DailyTimeSelection />}
      {frequency === FREQUENCY.WEEKLY && <WeeklyTimeSelection />}
      {frequency === FREQUENCY.CUSTOM && (
        <Form.Item
          label="Crontab Expression"
          name={['schedule', 'cron']}
          initialValue="0 0 * * *"
        >
          <Input style={{ maxWidth: 200 }} />
        </Form.Item>
      )}

      {nextSchedule && (
        <div className="gray-7">
          Estimated scheduled time:
          <span className="ml-2">{nextSchedule}</span>
        </div>
      )}
    </>
  );
}

function DailyTimeSelection() {
  return (
    <>
      <Form.Item label="Time" name={['schedule', 'time']}>
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
            initialValue={DAY_OF_WEEK[0]}
          >
            <Select
              style={{ minWidth: 123 }}
              options={DAY_OF_WEEK.map((value) => ({
                label: capitalize(value),
                value,
              }))}
            />
          </Form.Item>
        </Col>
        <Col>
          <Form.Item
            label="Time"
            name={['schedule', 'time']}
            initialValue={moment('00:00', timeFormat)}
          >
            <TimePicker minuteStep={10} format={timeFormat} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
