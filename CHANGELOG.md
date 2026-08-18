# Changelog

All notable changes are documented here.

## 0.1.7 — Multi-file fix

- Restored the project selector on the phone page so multi-file uploads work correctly.

## 0.1.6 — Multi-file upload

- The phone companion now accepts multiple selected files and delivers each one to the selected project inbox.
- Upload progress and any per-file delivery failure are shown on the phone.

## 0.1.5 — Non-interrupting delivery

- Files and notes now save quietly without automatically opening an editor or PDF viewer.
- Delivery is still confirmed in VS Code and every item remains available from AI Engine Stack Inbox.

## 0.1.4 — First-use pairing

- Shows the QR code automatically only on the first use after installation.
- Starts quietly on later VS Code launches, ready from the **AI Engine Stack** Activity Bar icon.

## 0.1.3 — Quieter daily startup

- Context Inbox now starts quietly when a workspace opens; it no longer opens a QR-code tab every day.
- Added an in-app guidance notification that points users to the **AI Engine Stack** Activity Bar icon.
- The QR-code action now starts Context Inbox itself if it is stopped.

## 0.1.2 — Alpha update

- Added **Show phone pairing QR code** to the AI Engine Stack extension’s right-click menu in the Extensions view.

## 0.1.1 — Alpha update

- Added a camera-button action beside the **AI Engine Stack Inbox** title to reopen the phone-pairing QR code.
- Made the bottom status-bar Context Inbox indicator reopen the QR code when clicked.
- Updated the user-facing name and companion visual design to AI Engine Stack — Context Inbox.

## 0.1.0 — Alpha

- Pair a phone via locally generated QR code.
- Send files, screenshots, PDFs, and notes into a selected project folder.
- Display a project inbox, unread status indicator, and AI-readable `INBOX.md` summary.
- Open received images in VS Code and PDFs in the system PDF viewer.

Known limitations: same Wi-Fi only; no user accounts, cloud relay, or agent-control integration.

### Latest alpha update

- Automatically starts when VS Code opens a workspace (configurable per workspace).
- Reads all folders currently open in a multi-root VS Code workspace.
- Lets the paired phone select a currently open project before sending context.
- Saves received items in the visible `phone-transfer/` folder at the project root.
- Renamed the product UI to **AI Engine Stack — Context Inbox** and aligned its phone and QR screens with the AI Engine Stack visual system.
