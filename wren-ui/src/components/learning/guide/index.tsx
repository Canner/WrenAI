import { driver } from 'driver.js';
import { useRouter } from 'next/router';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { DriverObj } from './utils';
import { makeStoriesPlayer } from './stories';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';

import 'driver.js/dist/driver.css';

interface Props {}

interface Attributes {
  play: (id: string, onDone: () => void) => void;
}

export default forwardRef<Attributes, Props>(function Guide(_props, ref) {
  const router = useRouter();
  const $driver = useRef<DriverObj>(null);

  const { data: settingsResult } = useGetSettingsQuery();
  const sampleDataset = useMemo(() => {
    return settingsResult?.settings?.dataSource.sampleDataset;
  }, [settingsResult?.settings]);

  useEffect(() => {
    if ($driver.current !== null) return;
    $driver.current = driver({
      progressText: '{{current}} / {{total}}',
      showProgress: true,
      nextBtnText: 'Next',
      prevBtnText: 'Previous',
      showButtons: ['next'],
      allowClose: false,
    });
    return () => {
      $driver.current.destroy();
      $driver.current = null;
    };
  }, []);

  const play = (id: string, onDone: () => void) => {
    const playStoryWithId = makeStoriesPlayer(
      $driver.current,
      router,
      sampleDataset,
    );
    playStoryWithId(id, onDone);
  };

  useImperativeHandle(ref, () => ({ play }), [$driver.current, router]);

  return null;
});
