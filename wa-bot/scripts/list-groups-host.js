/* Host-only helper to list groups using local sessions (no Docker). */
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}

const path = require('path');
const pino = require('pino');

async function main() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
  } = await import('@whiskeysockets/baileys');

  const { version } = await fetchLatestBaileysVersion();
  const sessionsPath = path.resolve(__dirname, '../sessions');
  const { state, saveCreds } = await useMultiFileAuthState(sessionsPath);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'info' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    version,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('OPEN');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message;
      console.log('CLOSE', code, msg);
    }
  });

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'open') {
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups);
      console.log(`Found ${groupList.length} groups:`);
      groupList.forEach((g) => {
        console.log(`${g.subject} :: ${g.id} :: members=${g.participants?.length ?? 0}`);
      });
      process.exit(0);
    }
  });
}

main().catch((err) => {
  console.error('Host list groups error:', err);
  process.exit(1);
});
