import { driver } from 'driver.js';
import { useRouter } from 'next/router';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { DriverObj } from './utils';
import { makeStories } from './stories';

import 'driver.js/dist/driver.css';

interface Props {}

interface Attributes {
  play: (value: string) => void;
}

export default forwardRef<Attributes, Props>(function Guide(_props, ref) {
  const router = useRouter();
  const $driver = useRef<DriverObj>(null);
  useImperativeHandle(ref, () => ({ play: playStoryWithId }), [
    $driver.current,
    router,
  ]);

  const playStoryWithId = makeStories($driver.current, router);

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
    };
  }, []);

  return null;
});
