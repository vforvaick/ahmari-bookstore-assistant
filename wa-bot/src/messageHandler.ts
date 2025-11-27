import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { detectFGBBroadcast, isOwnerMessage, DetectionResult } from './detector';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: 'info' });

export class MessageHandler {
  constructor(
    private sock: WASocket,
    private ownerJid: string,
    private mediaPath: string = './media'
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

    // Download media
    const mediaPaths: string[] = [];
    if (detection.hasMedia && detection.mediaMessages.length > 0) {
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

          // Save media file with unique filename
          const timestamp = Date.now();
          const filename = `fgb_${timestamp}_${mediaIndex}.${extension}`;
          const filepath = path.join(this.mediaPath, filename);

          fs.writeFileSync(filepath, buffer as Buffer);
          mediaPaths.push(filepath);

          logger.info(`Media saved: ${filepath}`);
          mediaIndex++;
        } catch (error) {
          logger.error('Failed to download media:', error);
        }
      }
    }

    // TODO: Send to AI processor for parsing
    // TODO: Generate draft
    // TODO: Send draft back to user for approval

    // For now, just acknowledge
    await this.sock.sendMessage(from, {
      text: `✓ FGB broadcast terdeteksi!\n\nProses parsing dan generate draft...\n\n(Fitur ini akan diimplementasi di task berikutnya)`,
    });

    logger.info('FGB broadcast processed, media count:', mediaPaths.length);
  }
}
