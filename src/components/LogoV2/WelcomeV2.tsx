import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from 'src/ink.js';
import { env } from '../../utils/env.js';
import { UrHouse } from './UrHouse.js';
const WELCOME_V2_WIDTH = 58;
export function WelcomeV2() {
  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column" alignItems="center">
      <Text>
        <Text color="ur">{'Welcome to UR'} </Text>
        <Text dimColor={true}>v{MACRO.VERSION}</Text>
      </Text>
      <UrHouse size="large" />
      <Text color="ur" dimColor={true}>
        the autonomous agent
      </Text>
    </Box>
  );
}
type AppleTerminalWelcomeV2Props = {
  theme: string;
  welcomeMessage: string;
};
function AppleTerminalWelcomeV2(_props: AppleTerminalWelcomeV2Props) {
  return <WelcomeV2 />;
}
