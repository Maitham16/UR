---
name: binary-reverse
description: Reverse compiled, managed, packed, obfuscated, browser, bytecode, VM, or protocol artifacts using static and dynamic analysis. Covers IDA, Ghidra, radare2, .NET, Go/Rust, macOS, JavaScript, browser extensions, binary diffing, and protocol reconstruction.
allowed-tools: Read Grep Glob Bash Edit Write TaskCreate TaskList TaskUpdate
---

# Binary reverse engineering

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`. Preserve the original artifact and hash every working copy.

## Workflow

1. Triage format, architecture, endianness, linkage, signatures, protections, packer/compiler/runtime clues, imports/exports, sections, strings, and embedded resources.
2. Choose the narrowest backend: Ghidra/IDA for decompilation and xrefs, radare2 for CLI triage/patches, dnSpy/IL tools for .NET, JADX/apktool for APK, browser devtools for JS/extensions, and Wireshark/custom parsers for protocols. Verify availability instead of guessing paths.
3. Build a symbol map from entrypoints, exports, handlers, constants, string xrefs, call graphs, serialization boundaries, syscalls, crypto use, and state transitions.
4. Form explicit hypotheses. Record evidence that would confirm or falsify each one.
5. Use dynamic work only when static evidence cannot settle the question: debugger breakpoints, API hooks, emulation, tracing, symbolic execution, or controlled replay. Execute unknown artifacts only in an approved isolated scope.
6. For version diffing, normalize symbols and match functions by control flow, constants, strings, and callers before interpreting security impact.
7. For custom VMs or protocols, recover framing/opcode tables, operand widths, state, errors, checksums, and test vectors; build a minimal parser/emulator with round-trip tests.
8. Synthesize a map of components, data flow, security-relevant behavior, unresolved questions, and reproducible commands.

Never patch the only copy. Keep offset/address notation explicit about image base, file offset, RVA/VA, architecture, and version.
