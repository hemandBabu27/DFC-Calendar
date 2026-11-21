import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.env.REMINDER_MODE || 'send';
const groupJid = (process.env.WHATSAPP_GROUP_JID || '').trim();
const authDir = path.resolve('auth_info_baileys');
const sentFile = path.resolve('sent.json');
const supabaseUrl = (process.env.SUPABASE_URL || 'https://wfdztznhzfxwfjrqqmqq.supabase.co').replace(/\/$/, '');
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_33DSLhmEs3EQG-I6chmGPg_mlZTHwiH';
const TZ = 'Asia/Kolkata';
const REMINDER_DAYS = 14;

function dateInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pick = (k) => parts.find(p => p.type === k)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function addDays(dateStr, count) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
function dateLabel(dateStr) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateStr + 'T12:00:00Z'));
}
function timeLabel(time) {
  if (!time) return '';
  const [hh, mm] = String(time).slice(0, 5).split(':').map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}
function messageFor(event) {
  const lines = ['📅 *DFC Calendar — 14-Day Reminder*', '', '🔔 An upcoming event is in *14 days*!', '', `📌 *${event.title || 'Event'}*`, `🗓️ *Date:* ${dateLabel(event.date)}`];
  if (event.time) lines.push(`⏰ *Time:* ${timeLabel(event.time)}`);
  if (event.notes?.trim()) lines.push('', `📝 *Details:* ${event.notes.trim()}`);
  lines.push('', 'Please save the date! 🎯', '', '_Automatic reminder from DFC Calendar._');
  return lines.join('\n');
}
function loadSent() {
  try { return JSON.parse(fs.readFileSync(sentFile, 'utf8')); } catch { return {}; }
}
function saveSent(data) {
  fs.writeFileSync(sentFile, JSON.stringify(data, null, 2) + '\n');
}
async function fetchDueEvents() {
  const target = addDays(dateInIndia(), REMINDER_DAYS);
  const url = new URL(`${supabaseUrl}/rest/v1/events`);
  url.searchParams.set('select', 'id,title,date,time,notes');
  url.searchParams.set('date', `eq.${target}`);
  const res = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { target, events: Array.isArray(data) ? data : [] };
}

const logger = pino({ level: 'silent' });
const { state, saveCreds } = await useMultiFileAuthState(authDir);
const sock = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false, connectTimeoutMs: 60000, defaultQueryTimeoutMs: 60000 });

let qrShown = false;
let completed = false;
let timeout;
const finish = async (exitCode = 0) => {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  try { sock.end(undefined); } catch {}
  if (exitCode) process.exitCode = exitCode;
};
sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
  if (qr && !qrShown) {
    qrShown = true;
    console.log('\nWhatsApp linking QR (scan in WhatsApp > Linked devices):\n');
    qrcode.generate(qr, { small: true });
    console.log('\nQR is temporary. Do not share these workflow logs.\n');
  }
  if (connection === 'open' && !completed) {
    console.log('WhatsApp linked and connected.');
    try {
      const groups = await sock.groupFetchAllParticipating();
      const list = Object.values(groups || {}).sort((a,b) => (a.subject || '').localeCompare(b.subject || ''));
      console.log('\nGroups (copy the target group JID into the WHATSAPP_GROUP_JID Actions secret):');
      for (const g of list) console.log(`${g.subject || '(unnamed)'} | ${g.id}`);
      if (mode === 'setup' || mode === 'list-groups') {
        await finish(0);
        return;
      }
      if (!groupJid) {
        console.error('WHATSAPP_GROUP_JID is not set. Choose a group JID from the list and add it as a GitHub Actions secret.');
        await finish(1);
        return;
      }
      if (!groupJid.endsWith('@g.us')) {
        console.error('Safety check: WHATSAPP_GROUP_JID must be a WhatsApp group JID ending in @g.us.');
        await finish(1);
        return;
      }
      if (!groups[groupJid]) console.warn('Configured group JID was not in the fetched group list. Attempting the configured group anyway.');
      const { target, events } = await fetchDueEvents();
      const sent = loadSent();
      const due = events.filter(e => e.id != null && !sent[`${e.id}|${e.date}`]);
      if (!due.length) {
        console.log(`No unsent reminders due for ${target}. No WhatsApp message sent.`);
        await finish(0);
        return;
      }
      for (const event of due) {
        await sock.sendMessage(groupJid, { text: messageFor(event) });
        sent[`${event.id}|${event.date}`] = { sentAt: new Date().toISOString(), eventTitle: String(event.title || '').slice(0,120), date: event.date };
        saveSent(sent);
        console.log(`Sent reminder for "${event.title}" on ${event.date} to configured group.`);
        await new Promise(r => setTimeout(r, 1800));
      }
      await finish(0);
    } catch (err) {
      console.error('Reminder run failed:', err?.message || err);
      await finish(1);
    }
  }
  if (connection === 'close' && !completed) {
    const status = lastDisconnect?.error?.output?.statusCode;
    if (status === DisconnectReason.loggedOut) console.error('WhatsApp session is logged out. Run setup and relink.');
    else console.error('WhatsApp connection closed before completing the task.', lastDisconnect?.error?.message || '');
    await finish(1);
  }
});

timeout = setTimeout(() => {
  console.error('Timed out waiting for WhatsApp connection/login. If a QR was printed, rerun setup and scan it promptly.');
  finish(1);
}, mode === 'setup' || mode === 'list-groups' ? 180000 : 90000);
