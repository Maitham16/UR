import * as React from 'react';
import { Box, Text } from '../../ink.js';

/**
 * UR Logo - Custom pixel-art style robot logo
 * A simple purple robot face with:
 * - Rectangular head
 * - Two square eyes
 * - Small ears on sides
 * - Four legs at bottom
 */
export function URLogo(): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      {/* Top row - ears */}
      <Box flexDirection="row">
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
      </Box>

      {/* Head top */}
      <Box flexDirection="row">
        <Text color="ur">▓▓▓▓▓▓▓</Text>
      </Box>

      {/* Eyes row */}
      <Box flexDirection="row">
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
      </Box>

      {/* Eyes */}
      <Box flexDirection="row">
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
      </Box>

      {/* Middle */}
      <Box flexDirection="row">
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
      </Box>

      {/* Head bottom */}
      <Box flexDirection="row">
        <Text color="ur">▓▓▓▓▓▓▓</Text>
      </Box>

      {/* Legs */}
      <Box flexDirection="row">
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
        <Text color="ur"> </Text>
        <Text color="ur"> </Text>
        <Text color="ur">▓</Text>
      </Box>
    </Box>
  );
}
