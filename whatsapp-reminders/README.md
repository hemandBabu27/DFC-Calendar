# DFC Calendar WhatsApp 14-day reminders

GitHub Actions checks the Supabase `events` table daily at 09:00 IST. Events exactly 14 days away are sent to one configured WhatsApp group. A ledger keyed by event ID and date prevents repeat sends.

**Unofficial WhatsApp Web automation.** Baileys is not affiliated with WhatsApp; automated messaging may violate WhatsApp terms and can lead to session/account restrictions. Use only for a group that expects reminders. Setup logs include a temporary QR code; never share those logs.

## GitHub Actions secrets

In repo **Settings → Secrets and variables → Actions → New repository secret**, add:

- `WA_SESSION_ENCRYPTION_KEY`: a long random key (at least 32 characters) to encrypt the linked WhatsApp session saved in this repository.
- `WHATSAPP_GROUP_JID`: the target group JID copied from the setup/list-groups workflow logs. Keep it private.

Supabase URL and publishable/anon key are already present in the calendar frontend and are used for read-only event lookup.

## Setup

1. Add the `WA_SESSION_ENCRYPTION_KEY` Actions secret first.
2. Open **Actions → DFC WhatsApp 14-day reminders → Run workflow**, choose `setup`.
3. Open the workflow run logs and scan the QR from WhatsApp **Linked devices** on your phone. Do not share logs.
4. After it connects, the logs show group names and IDs. Copy the target group ID and add it as `WHATSAPP_GROUP_JID` in Actions secrets.
5. Run `list-groups` to verify the saved session restores. Choose `send` for a reminder check; it only sends if an event is exactly 14 days away today.

Daily reminders are scheduled for 09:00 India time (03:30 UTC). After runs, Actions commits the encrypted WhatsApp session and reminder ledger.

## Security and duplicate handling

- Only the single configured group JID is used for sends; a group JID ending in `@g.us` is required.
- Sends occur only for events exactly 14 days ahead using the India date.
- The ledger prevents repeat sends for the same event ID/date.
- Session files are encrypted with AES-256-GCM before commit; the encryption key stays in GitHub Actions Secrets.
- To unlink: remove the linked device in WhatsApp, delete `whatsapp-reminders/session.enc`, and rotate the encryption secret.
