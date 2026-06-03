# Frontend

Expo app for the social-style UI.

## What is in place

- locale detection and locale persistence
- localized auth, feed, profile, notifications, safety, create, and admin screens
- RTL-aware layout adjustments for the main flows
- feed ads rendering
- Jest test setup for offline execution

## Status

| Area | Status | Notes |
| --- | --- | --- |
| Locale detection and persistence | Done | Locale is detected, stored, and reused across sessions. |
| RTL behavior | Mostly done | Main flows are RTL-aware and several screens are mirrored. |
| Feed ranking | Done | Dwell and interest signals influence feed ordering. |
| Onboarding | Done | New users are routed through a localized onboarding flow. |
| Moderation UI | Done | Admin and safety screens expose the moderation controls. |
| Ads rendering | Done | In-feed ad placement is wired into the feed. |
| Offline tests | Done | Jest runs locally without needing network access. |

## Run

```bash
npm install
npx expo start
```

## Test

```bash
npm test -- --runInBand
```
