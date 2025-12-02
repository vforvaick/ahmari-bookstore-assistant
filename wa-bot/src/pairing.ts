import { config } from 'dotenv';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';

config();

const logger = pino({ level: 'info' });

async function main() {
  const sessionsPath = path.resolve('./sessions');
  const { state, saveCreds } = await useMultiFileAuthState(sessionsPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }),
    browser: Browsers.macOS('Desktop'),
    version,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('QR code received (fallback). If pairing code fails, scan this:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('✓ WhatsApp connection established');
      process.exit(0);
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      logger.warn('Connection closed:', lastDisconnect?.error);

      if (shouldReconnect) {
        logger.info('Reconnecting...');
        await main();
      } else {
        logger.error('Logged out. Delete sessions folder to re-pair.');
        process.exit(1);
      }
    }
  });

  // If already paired, bail out early
  if (state.creds.registered) {
    logger.info('Already registered. Delete sessions to re-pair.');
    process.exit(0);
  }

  const phoneFromJid = (process.env.OWNER_JID || '').split('@')[0];
  const pairingPhone = process.env.PAIRING_PHONE || phoneFromJid;

  if (!pairingPhone) {
    throw new Error(
      'Set PAIRING_PHONE env (MSISDN digits, no + or spaces). Example: 6285121080846'
    );
  }

  logger.info(
    `Requesting pairing code for ${pairingPhone}. Open WhatsApp → Linked devices → Link with phone number, then enter this code:`
  );

  const code = await sock.requestPairingCode(pairingPhone);
  logger.info(`Pairing code: ${code}`);
  logger.info('Waiting for device to connect...');
}

main().catch((error) => {
  logger.error('Failed to generate pairing code:', error);
  process.exit(1);
});
