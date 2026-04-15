import { driver } from 'driver.js';
import { useRouter } from 'next/router';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dispatcher, DriverObj } from './utils';
import { makeStoriesPlayer } from './stories';
import { fetchSettings } from '@/utils/settingsRest';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  ProjectLanguage,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

import 'driver.js/dist/driver.css';

interface Props {}

interface Attributes {
  play: (id: string, dispatcher: Dispatcher) => void;
}

export default forwardRef<Attributes, Props>(function Guide(_props, ref) {
  const router = useRouter();
  const $driver = useRef<DriverObj | null>(null);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [settingsResult, setSettingsResult] = useState<Awaited<
    ReturnType<typeof fetchSettings>
  > | null>(null);

  const storyPayload = useMemo(() => {
    const sampleDataset = settingsResult?.dataSource?.sampleDataset;
    const language = settingsResult?.language;

    return {
      sampleDataset:
        sampleDataset &&
        Object.values(SampleDatasetName).includes(
          sampleDataset as SampleDatasetName,
        )
          ? (sampleDataset as SampleDatasetName)
          : undefined,
      language:
        language &&
        Object.values(ProjectLanguage).includes(language as ProjectLanguage)
          ? (language as ProjectLanguage)
          : undefined,
    };
  }, [settingsResult?.dataSource?.sampleDataset, settingsResult?.language]);

  useEffect(() => {
    void fetchSettings(runtimeScopeNavigation.selector)
      .then((payload) => {
        setSettingsResult(payload);
      })
      .catch(() => {
        setSettingsResult(null);
      });
  }, [runtimeScopeNavigation.selector]);

  useEffect(() => {
    if ($driver.current !== null) return;
    $driver.current = driver();
    return () => {
      $driver.current?.destroy();
      $driver.current = null;
    };
  }, []);

  const play = (id: string, dispatcher: Dispatcher) => {
    if (!$driver.current) {
      return;
    }
    const playStoryWithId = makeStoriesPlayer(
      $driver.current,
      router,
      storyPayload,
    );
    playStoryWithId(id, dispatcher);
  };

  useImperativeHandle(ref, () => ({ play }), [router, storyPayload]);

  return null;
});
