import { useEffect, useState, type ReactElement } from 'react';
import { Text } from 'ink';

const FRAMES: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ label }: { label: string }): ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((frame: number) => (frame + 1) % FRAMES.length), 80);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <Text color="cyan">
      {FRAMES[frame] ?? ''} {label}
    </Text>
  );
}
