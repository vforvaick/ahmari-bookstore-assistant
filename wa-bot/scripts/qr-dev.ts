import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import qrcode from 'qrcode-terminal';
import { config } from 'dotenv';

config();

async function main() {
  const { version } = await fetchLatestBaileysVersion();
  const sessionsPath = path.resolve('./sessions');
  const { state, saveCreds } = await useMultiFileAuthState(sessionsPath);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'info' }),
    printQRInTerminal: true,
    browser: Browsers.macOS('Desktop'),
    version,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('OPEN');
    }

    if (connection === 'close') {
      const code = (lastDisconnect as any)?.error?.output?.statusCode;
      const msg = (lastDisconnect as any)?.error?.message;
      console.log('CLOSE', code, msg);
    }
  });
}

main().catch((err) => {
  console.error('QR dev error:', err);
  process.exit(1);
});
