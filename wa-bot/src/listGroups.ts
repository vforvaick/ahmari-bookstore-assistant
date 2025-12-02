import { config } from 'dotenv';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { loadBaileys } from './baileysLoader';

config();

const logger = pino({ level: 'info' });

async function main() {
  const sessionsPath = path.resolve('./sessions');
  const baileys = await loadBaileys();
  const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionsPath);
  const { version } = await baileys.fetchLatestBaileysVersion();

  const sock = baileys.default({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }),
    browser: baileys.Browsers.macOS('Desktop'),
    version,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('QR code received. Scan to authenticate:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('✓ Connected. Fetching groups...');
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups);

      logger.info(`Found ${groupList.length} groups:`);
      logger.info('─'.repeat(80));
      groupList.forEach((group) => {
        logger.info(`Name : ${group.subject}`);
        logger.info(`JID  : ${group.id}`);
        logger.info(`Member count: ${group.participants?.length ?? 0}`);
        logger.info('─'.repeat(80));
      });

      process.exit(0);
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        baileys.DisconnectReason.loggedOut;

      logger.warn('Connection closed:', lastDisconnect?.error);

      if (shouldReconnect) {
        logger.info('Reconnecting...');
        await main();
      } else {
        logger.error('Logged out. Delete sessions folder to re-login.');
        process.exit(1);
      }
    }
  });
}

main().catch((error) => {
  logger.error('Failed to list groups:', error);
  process.exit(1);
});
