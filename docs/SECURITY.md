# Security Model

## Current alpha

- The companion server starts only after a user action in VS Code.
- Automatic start is scoped to each VS Code workspace and can be disabled in that workspace’s settings.
- A random pairing token is generated for each VS Code start and invalidated when the companion stops.
- The token is required for every API request from the phone page.
- Received filenames are sanitized and saved only beneath the phone-selected, currently open project’s `phone-transfer/inbox/` directory.
- File size is limited by the VS Code setting `aiRemoteControl.maxUploadMb`.
- The extension exposes no endpoint for shell execution, opening arbitrary paths, or controlling an AI agent.
- The companion is intended for trusted same-Wi-Fi networks; do not expose its port publicly.

## Before remote access is added

Remote access requires authenticated user accounts, explicit device approval, encrypted relay connections, short-lived session credentials, audit events, and revocation. It must not be implemented by forwarding the current local port through a public tunnel.
