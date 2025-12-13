import pino from 'pino';
import { detectFGBBroadcast, DetectionResult } from './detector';
import { AIClient, GenerateResponse } from './aiClient';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { loadBaileys, WASocket, proto } from './baileysLoader';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Pending draft state (simple in-memory for now)
interface PendingDraft {
  draft: string;
  mediaPaths: string[];
  timestamp: number;
}

export class MessageHandler {
  private ownerJids: string[];
  private pendingDraft: PendingDraft | null = null;
  private targetGroupJid: string | null;

  constructor(
    private sock: WASocket,
    ownerJidOrList: string | string[],
    private aiClient: AIClient,
    private mediaPath: string = './media',
    private baileysPromise = loadBaileys()
  ) {
    this.ownerJids = Array.isArray(ownerJidOrList) ? ownerJidOrList : [ownerJidOrList];
    this.targetGroupJid = process.env.TARGET_GROUP_JID || null;

    if (this.targetGroupJid) {
      logger.info(`Target group JID configured: ${this.targetGroupJid}`);
    } else {
      logger.warn('TARGET_GROUP_JID not set - broadcast sending disabled');
    }

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

      // Check if sender is one of the owners (phone or LID)
      const isFromOwner = this.ownerJids.includes(from);

      // Only process messages from owner (istri)
      if (!isFromOwner) {
        logger.debug(`Ignoring message from non-owner: ${from}`);
        return;
      }

      logger.info(`Processing message from owner: ${from}`);

      // Check for YES/SCHEDULE response first
      const messageText = this.extractMessageText(message);

      if (this.pendingDraft) {
        const handled = await this.handlePendingResponse(from, messageText);
        if (handled) return;
      }

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

  private extractMessageText(message: proto.IWebMessageInfo): string {
    const content = message.message;
    if (!content) return '';

    return (
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      ''
    ).toLowerCase().trim();
  }

  private async handlePendingResponse(from: string, text: string): Promise<boolean> {
    if (!this.pendingDraft) return false;

    // Check for YES response
    if (text === 'yes' || text === 'y' || text === 'ya' || text === 'iya') {
      await this.sendBroadcast(from);
      return true;
    }

    // Check for SCHEDULE response
    if (text.includes('schedule') || text.includes('antri') || text.includes('nanti')) {
      await this.scheduleBroadcast(from);
      return true;
    }

    // Check for EDIT response
    if (text.includes('edit') || text.includes('ubah') || text.includes('ganti')) {
      await this.sock.sendMessage(from, {
        text: '✏️ Silakan edit manual draft-nya lalu forward ulang ke saya ya!'
      });
      this.clearPendingDraft();
      return true;
    }

    // Check for CANCEL response
    if (text.includes('cancel') || text.includes('batal') || text.includes('skip')) {
      await this.sock.sendMessage(from, {
        text: '❌ Draft dibatalkan.'
      });
      this.clearPendingDraft();
      return true;
    }

    // Check if draft is expired (5 minutes)
    if (Date.now() - this.pendingDraft.timestamp > 5 * 60 * 1000) {
      logger.info('Pending draft expired');
      this.clearPendingDraft();
      return false;
    }

    return false;
  }

  private async sendBroadcast(from: string) {
    if (!this.pendingDraft) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada draft yang pending.'
      });
      return;
    }

    if (!this.targetGroupJid) {
      await this.sock.sendMessage(from, {
        text: '❌ TARGET_GROUP_JID belum di-set. Tidak bisa kirim ke grup.'
      });
      this.clearPendingDraft();
      return;
    }

    try {
      const { draft, mediaPaths } = this.pendingDraft;

      // Send to target group
      if (mediaPaths.length > 0 && fs.existsSync(mediaPaths[0])) {
        await this.sock.sendMessage(this.targetGroupJid, {
          image: { url: mediaPaths[0] },
          caption: draft
        });
      } else {
        await this.sock.sendMessage(this.targetGroupJid, {
          text: draft
        });
      }

      logger.info(`Broadcast sent to group: ${this.targetGroupJid}`);

      // Confirm to owner
      await this.sock.sendMessage(from, {
        text: `✅ Broadcast berhasil dikirim ke grup!`
      });

    } catch (error: any) {
      logger.error('Failed to send broadcast:', error);
      await this.sock.sendMessage(from, {
        text: `❌ Gagal kirim broadcast: ${error.message}`
      });
    } finally {
      this.clearPendingDraft();
    }
  }

  private async scheduleBroadcast(from: string) {
    // For now, just save to queue - full implementation would use database
    await this.sock.sendMessage(from, {
      text: '📅 Fitur schedule masih dalam pengembangan. Untuk sementara, silakan kirim manual dengan reply YES.'
    });
    // Don't clear pending draft so user can still reply YES
  }

  private clearPendingDraft() {
    if (this.pendingDraft) {
      // Cleanup any remaining media files
      for (const filepath of this.pendingDraft.mediaPaths) {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            logger.debug(`Cleaned up media: ${filepath}`);
          }
        } catch (error) {
          logger.error(`Failed to cleanup media ${filepath}:`, error);
        }
      }
      this.pendingDraft = null;
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

    // Clear any existing pending draft
    this.clearPendingDraft();

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

      // Store pending draft
      this.pendingDraft = {
        draft: generated.draft,
        mediaPaths: [...mediaPaths], // Copy paths, don't cleanup yet
        timestamp: Date.now()
      };

      // Send draft with media
      if (mediaPaths.length > 0) {
        await this.sock.sendMessage(from, {
          image: { url: mediaPaths[0] },
          caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      } else {
        await this.sock.sendMessage(from, {
          text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      }

      // DON'T cleanup media yet - wait for YES response

    } catch (error: any) {
      logger.error('Error processing FGB broadcast:', error);
      await this.sock.sendMessage(from, {
        text: `❌ Error: ${error.message}\n\nSilakan coba lagi.`,
      });

      // Cleanup on error
      for (const filepath of mediaPaths) {
        try {
          await fsPromises.unlink(filepath);
          logger.debug(`Cleaned up media: ${filepath}`);
        } catch (err) {
          logger.error(`Failed to cleanup media ${filepath}:`, err);
        }
      }
    }
  }
}
