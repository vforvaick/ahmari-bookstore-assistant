import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { MessageHandler } from './messageHandler';
import type { AIClient } from './aiClient';
import { loadBaileys, WASocket } from './baileysLoader';
import { notifyConnected, notifyDisconnected } from './healthServer';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private sessionsPath: string;
  private messageHandler: MessageHandler | null = null;
  public isConnected: boolean = false;

  // Store handler config for rebinding after reconnection
  private handlerConfig: {
    ownerJids: string[];
    aiClient: AIClient;
    mediaPath: string;
  } | null = null;

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
      // Keep connection alive - ping every 25 seconds
      keepAliveIntervalMs: 25000,
      // Retry delay for failed requests
      retryRequestDelayMs: 2000,
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
        this.isConnected = false;
        notifyDisconnected();

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
        this.isConnected = true;
        notifyConnected();
        logger.info('✓ WhatsApp connection established');

        // CRITICAL: Rebind message handler to new socket after reconnection
        if (this.handlerConfig && this.messageHandler) {
          logger.info('Rebinding message handler to new socket...');
          this.bindMessageListener();
          logger.info('✓ Message handler rebound successfully');
        }
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
    ownerJids: string | string[],
    aiClient: AIClient,
    mediaPath: string = './media'
  ) {
    if (!this.sock) {
      throw new Error('Socket not connected');
    }

    // Accept both single string or array of owner JIDs
    const owners = Array.isArray(ownerJids) ? ownerJids : [ownerJids];

    // Store config for rebinding after reconnection
    this.handlerConfig = {
      ownerJids: owners,
      aiClient,
      mediaPath
    };

    // Create message handler with current socket
    this.messageHandler = new MessageHandler(
      this.sock,
      owners,
      aiClient,
      mediaPath
    );

    // Bind the message listener
    this.bindMessageListener();
  }

  /**
   * Bind message listener to current socket.
   * Called during initial setup and after reconnection.
   */
  private bindMessageListener() {
    if (!this.sock || !this.messageHandler) {
      logger.warn('Cannot bind message listener: socket or handler not ready');
      return;
    }

    // Listen for messages with error handling
    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
        try {
          const remoteJid = message.key.remoteJid || '';

          // Log incoming message for debugging
          logger.info({
            fromMe: message.key.fromMe,
            remoteJid: remoteJid,
            pushName: message.pushName
          }, 'Incoming message event');

          // Skip ALL messages from self (fromMe = true)
          if (message.key.fromMe) {
            logger.debug(`Skipping fromMe message: ${remoteJid}`);
            continue;
          }

          // Handle message with error protection
          await this.messageHandler!.handleMessage(message);
        } catch (error) {
          logger.error({ error, messageId: message.key.id }, 'Error processing message');
        }
      }
    });
  }
}
