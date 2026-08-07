# Remote Account and Device Architecture

## Objective

Allow a developer to sign in once, pair approved phone and desktop devices, and send project context from anywhere without exposing a laptop port publicly.

## First release boundaries

- The existing local QR workflow remains available without an account.
- Account mode adds remote transfer and device management; it does not grant arbitrary shell access.
- The cloud stores account and routing metadata. Project paths, local credentials, and agent tokens never leave the laptop.
- A remote upload is stored encrypted in object storage or relayed to the desktop, then written only beneath the chosen project’s `phone-transfer/` folder.

## Pairing flow

```text
Extension starts → creates short-lived pairing request
                         ↓
Phone PWA signs in with email magic link or Google
                         ↓
Phone scans QR and claims pairing request
                         ↓
Relay tells extension its device is approved
                         ↓
Extension stores a revocable device credential in VS Code Secret Storage
```

The QR code is only a short-lived pairing capability. It is not a permanent login credential.

## Remote transfer flow

```text
Phone app → authenticated API → encrypted relay/object storage → outbound desktop connection → selected project/phone-transfer
```

The desktop creates the outbound connection. No router configuration, Cloudflare tunnel, or public listener is used.

## Required future components

| Component | Responsibility |
|---|---|
| Hosted mobile PWA | Email/Google sign-in, devices, projects, upload, notifications |
| Supabase Auth | User identity and refresh sessions |
| Supabase Postgres | Device, pairing, project metadata, and audit events |
| Edge functions / relay | Pairing, authorization, upload routing, signed storage URLs |
| Desktop companion | Persistent connection when VS Code is closed (later phase) |
| VS Code extension | Open-workspace detection, local transfer, inbox UI |

## Security rules

- Never put a Supabase service-role key, Google client secret, agent token, or local project path in the extension/mobile app.
- Store only a device credential locally and make it revocable.
- Require explicit device pairing and record every pairing, upload, and remote action.
- Limit every remote operation to a typed action: upload, note, stop, approve, reject, or follow-up. Never accept arbitrary shell commands.
