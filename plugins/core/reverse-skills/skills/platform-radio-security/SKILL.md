---
name: platform-radio-security
description: Research mobile apps, firmware, embedded hardware, OT/ICS systems, Wi-Fi, wireless, and SDR/radio targets in owned or explicitly authorized labs.
allowed-tools: Read Grep Glob Bash Edit Write TaskCreate TaskList TaskUpdate
---

# Platform, device, and radio security

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`. Device mutation, packet injection, RF transmission, wireless association, and active OT traffic require explicit current-session scope.

## Workflow

1. Inventory device/app/version, physical interfaces, radios, boot chain, update path, storage, debug ports, network protocols, mobile protections, and safety/availability constraints.
2. Acquire read-only artifacts first: app package, firmware image, flash dump, UART logs, update bundle, traffic capture, board photos, symbols, configuration, and bill of materials. Hash and preserve originals.
3. Mobile: map components, permissions/entitlements, exported surfaces, IPC/deep links, WebViews, local secrets, TLS/pinning, root/jailbreak checks, native libraries, and backend trust boundaries. Use controlled Frida/Objection hooks only in the approved lab.
4. Firmware/hardware: unpack filesystems, identify architecture and bootloader, map services and credentials, review signing/rollback, emulate when possible, and use UART/JTAG/SWD in read-only mode before any write.
5. OT/ICS: model Purdue zones and process consequences. Prefer passive captures and configuration review. Use protocol-aware simulation/digital twins; do not scan or fuzz production controllers.
6. Wi-Fi: record owned SSIDs/BSSIDs/channels and test stations. Bound deauthentication, handshake/PMKID capture, rogue AP, and credential validation to the lab and approved rates.
7. SDR/radio: identify jurisdiction, frequency, power, bandwidth, duty cycle, shielding/dummy-load needs, and receive-only alternatives. Default to receive-only; require explicit approval for transmission or replay.
8. Validate findings with a reversible proof, record physical/safety preconditions, and provide remediation plus recovery steps.

Stop immediately on unexpected process impact, uncontrolled RF propagation, unsafe actuator state, or evidence that the observed asset is outside scope.
