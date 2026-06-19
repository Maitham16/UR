import * as React from 'react';
import { Box, Text } from '../../ink.js';

const LARGE = [
  '    ╱╲    ',
  '   ╱  ╲   ',
  '  ╱    ╲  ',
  ' ╱______╲ ',
  ' │ ▣  ▣ │ ',
  ' │      │ ',
  ' │  ▢▢  │ ',
  ' └──────┘ ',
];

const SMALL = [
  ' ╱╲ ',
  '╱──╲',
  '│▣▣│',
  '└▢▢┘',
];

export type UrHouseProps = {
  size?: 'small' | 'large';
};

export function UrHouse({ size = 'large' }: UrHouseProps): React.ReactNode {
  const rows = size === 'small' ? SMALL : LARGE;
  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, i) => (
        <Text key={i} color="ur">
          {row}
        </Text>
      ))}
    </Box>
  );
}
