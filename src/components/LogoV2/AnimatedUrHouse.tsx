import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useAnimationFrame } from '../../ink.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { hueToRgb, toRGBColor } from '../Spinner/utils.js';
import { UR_HOUSE } from '../../constants/figures.js';

const BUILD_FRAMES = ['·', '▖', '▃', '▆', '█', UR_HOUSE];
const FRAME_MS = 220;
const TOTAL_ANIMATION_MS = FRAME_MS * BUILD_FRAMES.length;
const SETTLED_GREY = toRGBColor({ r: 153, g: 153, b: 153 });

export function AnimatedUrHouse({
  char,
}: {
  char?: string;
}): React.ReactNode {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  );
  const [done, setDone] = useState(reducedMotion);
  const startTimeRef = useRef<number | null>(null);
  const [ref, time] = useAnimationFrame(done ? null : 50);
  const settled = char ?? UR_HOUSE;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(setDone, TOTAL_ANIMATION_MS, true);
    return () => clearTimeout(t);
  }, [done]);

  if (done) {
    return (
      <Box ref={ref}>
        <Text color={SETTLED_GREY}>{settled}</Text>
      </Box>
    );
  }

  if (startTimeRef.current === null) {
    startTimeRef.current = time;
  }
  const elapsed = time - startTimeRef.current;
  const index = Math.min(
    BUILD_FRAMES.length - 1,
    Math.floor(elapsed / FRAME_MS),
  );
  const frame = char ?? BUILD_FRAMES[index];
  const hue = ((elapsed / TOTAL_ANIMATION_MS) * 360) % 360;

  return (
    <Box ref={ref}>
      <Text color={toRGBColor(hueToRgb(hue))}>{frame}</Text>
    </Box>
  );
}
