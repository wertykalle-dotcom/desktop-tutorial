# Manual QA: Account Health, Moderation, Trust Score

Run these checks after backend and frontend are running:

- Backend: port `8000`
- Frontend: port `8081`

## Account Health

1. Open `Asetukset`.
2. Find `Account Health` / `Tilin luotettavuus`.
3. Verify:
   - Trust Score is visible.
   - Status is visible: `Hyva`, `Tarkkailussa`, or `Rajoitettu`.
   - Active restrictions count is visible.
   - Recovery timing is visible.
   - Recent warnings or restricted posts are visible when they exist.

## Moderation Queue

1. Report a post from the three-dot menu.
2. Open `Moderation Queue`.
3. Verify the report appears in the queue.
4. Test decisions:
   - `Hyvaksy` clears copyright/music warning and restores distribution.
   - `Rajoita` marks distribution as limited.
   - `Varoita` sends a warning and lowers Trust Score.
   - `Poista` hides/removes the post and lowers Trust Score more strongly.
5. Verify the queue item moves to moderation history.

## Notifications

1. Trigger a moderation decision that changes Trust Score.
2. Open `Ilmoitukset`.
3. Verify user-facing notification text appears:
   - `Julkaisusi hyvaksyttiin`
   - `Julkaisusi jakelua rajoitettiin`
   - `Sait moderointivaroituksen`
   - `Julkaisusi poistettiin`
   - `Trust Score paivitettiin`

## Music Warning

1. Create or report a video/live replay with music-related wording.
2. Verify the post shows a music warning in:
   - Feed
   - Media
   - Post Detail
3. Verify the warning does not block playback.

## Copyright Report

1. Use the three-dot menu on a post.
2. Choose the copyright/music report action.
3. Verify:
   - The report is accepted.
   - The item appears in Moderation Queue.
   - Account Health updates after moderator action.
   - Notification is sent after moderator action.

## Profile

1. Open `Profiili`.
2. Open `Asetukset`.
3. Verify:
   - Account Health is present.
   - Trust Score is current.
   - Recovery message is understandable.
   - Achievements area remains visible in profile mode.

## Pass Criteria

The flow passes when a reported post can move through moderation, affect Trust Score, notify the user, and appear correctly in Account Health without page refresh hacks or broken mobile layout.
