import pino from 'pino';
import { detectFGBBroadcast, isOwnerMessage, DetectionResult } from './detector';
import { AIClient } from './aiClient';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { loadBaileys, WASocket, proto } from './baileysLoader';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class MessageHandler {
  constructor(
    private sock: WASocket,
    private ownerJid: string,
    private aiClient: AIClient,
    private mediaPath: string = './media',
    private baileysPromise = loadBaileys()
  ) {
    // Ensure media directory exists
    if (!fs.existsSync(mediaPath)) {
      fs.mkdirSync(mediaPath, { recursive: true });
    }
  }

  async handleMessage(message: proto.IWebMessageInfo) {
    try {
      // Get sender info
      const from = message.key.remoteJid;
      if (!from) {
        logger.debug('Ignoring message with no remoteJid');
        return;
      }

      const isFromOwner = isOwnerMessage(from, this.ownerJid);

      // Only process messages from owner (istri)
      if (!isFromOwner) {
        logger.debug(`Ignoring message from non-owner: ${from}`);
        return;
      }

      logger.info(`Processing message from owner: ${from}`);

      // Detect if this is an FGB broadcast
      const detection = detectFGBBroadcast(message);

      if (detection.isFGBBroadcast) {
        logger.info('FGB broadcast detected!');
        await this.processFGBBroadcast(message, detection);
      } else {
        logger.debug('Not an FGB broadcast, ignoring');
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  private async processFGBBroadcast(
    message: proto.IWebMessageInfo,
    detection: DetectionResult
  ) {
    const from = message.key.remoteJid;
    if (!from) {
      logger.warn('processFGBBroadcast called with no remoteJid');
      return;
    }

    const mediaPaths: string[] = [];

    try {
      // Send processing message (friendly progress info)
      await this.sock.sendMessage(from, {
        text: [
          '⏳ Lagi proses broadcast...',
          '• Download media',
          '• Parse konten',
          '• Generate draft AI',
          '',
          'Mohon tunggu ±20-30 detik ya 🙏',
        ].join('\n'),
      });

      // Download media
      if (detection.hasMedia && detection.mediaMessages.length > 0) {
        const { downloadMediaMessage } = await this.baileysPromise;
        let mediaIndex = 0;
        for (const mediaMsg of detection.mediaMessages) {
          try {
            const buffer = await downloadMediaMessage(
              { message: mediaMsg } as any,
              'buffer',
              {}
            );

            // Determine file extension from media type
            let extension = 'bin';
            if (mediaMsg.imageMessage) {
              extension = 'jpg';
            } else if (mediaMsg.videoMessage) {
              extension = 'mp4';
            }

            // Save media file with unique filename (async)
            const timestamp = Date.now();
            const filename = `fgb_${timestamp}_${mediaIndex}.${extension}`;
            const filepath = path.join(this.mediaPath, filename);

            await fsPromises.writeFile(filepath, buffer as Buffer);
            mediaPaths.push(filepath);

            logger.info(`Media saved: ${filepath}`);
            mediaIndex++;
          } catch (error) {
            logger.error('Failed to download media:', error);
          }
        }
      }

      // Parse with AI Processor
      const parsedData = await this.aiClient.parse(
        detection.text,
        mediaPaths.length
      );

      logger.info(`Parse successful - format: ${parsedData.format || 'unknown'}`);

      // Generate draft
      const generated = await this.aiClient.generate(parsedData);

      logger.info('Draft generated successfully');

      // Send draft with media
      if (mediaPaths.length > 0) {
        await this.sock.sendMessage(from, {
          image: { url: mediaPaths[0] },
          caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim sekarang\n• *EDIT DULU* - edit manual dulu\n• *SCHEDULE* - masukkan ke antrian`,
        });
      } else {
        await this.sock.sendMessage(from, {
          text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim sekarang\n• *EDIT DULU* - edit manual dulu\n• *SCHEDULE* - masukkan ke antrian`,
        });
      }

      // TODO: Save conversation state to database
      // TODO: Wait for user response (YES/EDIT/SCHEDULE)

    } catch (error: any) {
      logger.error('Error processing FGB broadcast:', error);
      await this.sock.sendMessage(from, {
        text: `❌ Error: ${error.message}\n\nSilakan coba lagi.`,
      });
    } finally {
      // Cleanup temporary media files
      for (const filepath of mediaPaths) {
        try {
          await fsPromises.unlink(filepath);
          logger.debug(`Cleaned up media: ${filepath}`);
        } catch (error) {
          logger.error(`Failed to cleanup media ${filepath}:`, error);
        }
      }
    }
  }
}
