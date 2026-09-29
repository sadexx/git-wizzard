import { useEffect, useState, type ReactElement } from 'react';
import { Text } from 'ink';

const FRAMES: readonly string[] = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

/** Monochrome activity indicator with elapsed seconds (the AI calls can take a while). */
export function Spinner({ label }: { label: string }): ReactElement {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((previous: number) => previous + 1), 120);
    return () => {
      clearInterval(id);
    };
  }, []);
  const seconds = Math.floor((tick * 120) / 1000);
  return (
    <Text>
      <Text bold>{FRAMES[tick % FRAMES.length] ?? '·'}</Text> {label}…
      {seconds > 0 ? <Text dimColor> {seconds}s</Text> : null}
    </Text>
  );
}
