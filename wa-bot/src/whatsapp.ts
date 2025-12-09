import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { MessageHandler } from './messageHandler';
import type { AIClient } from './aiClient';
import { loadBaileys, WASocket } from './baileysLoader';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private sessionsPath: string;
  private messageHandler: MessageHandler | null = null;

  constructor(sessionsPath: string = './sessions') {
    this.sessionsPath = sessionsPath;
  }

  async connect(): Promise<WASocket> {
    const baileys = await loadBaileys();
    const { version } = await baileys.fetchLatestBaileysVersion();

    // Use SQLite-based auth state for better reliability
    const { useSqliteAuthState } = await import('./sqliteAuthState');
    const { state, saveCreds } = await useSqliteAuthState(
      path.resolve(this.sessionsPath, 'session.db')
    );

    this.sock = baileys.default({
      auth: state,
      printQRInTerminal: false, // We'll handle QR display ourselves
      logger: pino({ level: process.env.LOG_LEVEL || 'warn' }),
      browser: baileys.Browsers.macOS('Desktop'),
      version,
      getMessage: async (key) => {
        // Retrieve message from store if needed
        return { conversation: '' };
      },
    });

    // Handle credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Display QR code
      if (qr) {
        logger.info('QR Code received, scan to authenticate:');
        qrcode.generate(qr, { small: true });
      }

      // Handle connection states
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          baileys.DisconnectReason.loggedOut;

        logger.warn('Connection closed:', lastDisconnect?.error);

        if (shouldReconnect) {
          logger.info('Reconnecting...');
          await this.connect();
        } else {
          logger.error('Logged out, please delete sessions and restart');
          process.exit(1);
        }
      } else if (connection === 'open') {
        logger.info('✓ WhatsApp connection established');
      }
    });

    return this.sock;
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
  }

  setupMessageHandler(
    ownerJid: string,
    aiClient: AIClient,
    mediaPath: string = './media'
  ) {
    if (!this.sock) {
      throw new Error('Socket not connected');
    }

    this.messageHandler = new MessageHandler(
      this.sock,
      ownerJid,
      aiClient,
      mediaPath
    );

    // Listen for messages
    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
        // Log incoming message for debugging
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug({
            fromMe: message.key.fromMe,
            remoteJid: message.key.remoteJid,
            pushName: message.pushName
          }, 'Incoming message');
        }

        // Ignore messages from self, UNLESS it's sent to self (Note to Self)
        if (message.key.fromMe && message.key.remoteJid !== ownerJid) {
          continue;
        }

        // Handle message
        await this.messageHandler!.handleMessage(message);
      }
    });
  }
}
