import pino from 'pino';
import { detectFGBBroadcast, DetectionResult } from './detector';
import { AIClient, GenerateResponse } from './aiClient';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { loadBaileys, WASocket, proto } from './baileysLoader';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Pending state (simple in-memory for now)
interface PendingState {
  // State: 'level_selection' or 'draft_pending'
  state: 'level_selection' | 'draft_pending';
  parsedData?: any;  // ParsedBroadcast from AI processor
  mediaPaths: string[];
  draft?: string;
  timestamp: number;
}

export class MessageHandler {
  private ownerJids: string[];
  private pendingState: PendingState | null = null;
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

      // Extract message text
      const messageText = this.extractMessageText(message);

      // Debug logging
      logger.info({
        messageText: messageText.substring(0, 50),
        hasPendingState: !!this.pendingState,
        targetGroup: this.targetGroupJid
      }, 'Message processing');

      // Handle slash commands first
      if (messageText.startsWith('/')) {
        const handled = await this.handleSlashCommand(from, messageText);
        if (handled) return;
      }

      // Check for pending state responses 
      if (this.pendingState) {
        logger.info('Checking pending response...');
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

  private async handleSlashCommand(from: string, text: string): Promise<boolean> {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    try {
      switch (command) {
        case '/help':
          await this.sendHelp(from);
          return true;

        case '/status':
          await this.sendStatus(from);
          return true;

        case '/groups':
          await this.listGroups(from);
          return true;

        case '/setgroup':
          await this.setTargetGroup(from, args);
          return true;

        case '/cancel':
          this.clearPendingState();
          await this.sock.sendMessage(from, { text: '❌ Pending state cleared.' });
          return true;

        case '/setmarkup':
          await this.setMarkup(from, args);
          return true;

        case '/getmarkup':
          await this.getMarkup(from);
          return true;

        default:
          return false;
      }
    } catch (error: any) {
      logger.error(`Error handling command ${command}:`, error);
      await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
      return true;
    }
  }

  private async sendHelp(from: string) {
    await this.sock.sendMessage(from, {
      text: `🤖 *Ahmari Bookstore Bot - Command Center*

*Commands:*
/help - Tampilkan bantuan ini
/status - Status bot dan konfigurasi
/groups - List semua grup yang bot sudah join
/setgroup <JID> - Set target grup untuk broadcast
/setmarkup <angka> - Set markup harga (contoh: 20000)
/getmarkup - Lihat markup harga saat ini
/cancel - Batalkan pending draft

*Cara pakai:*
1. Forward broadcast FGB ke sini
2. Bot akan generate draft dengan harga +markup
3. Reply YES untuk kirim ke grup

*Tips:*
- JID grup format: 120363XXXXX@g.us
- Gunakan /groups untuk lihat JID`
    });
  }

  private async sendStatus(from: string) {
    const groupName = this.targetGroupJid || 'Not set';
    const hasPending = this.pendingState ? 'Yes' : 'No';

    // Get AI processor config
    let markupInfo = 'N/A';
    try {
      const config = await this.aiClient.getConfig();
      markupInfo = `Rp ${config.price_markup.toLocaleString('id-ID')}`;
    } catch {
      markupInfo = 'Error fetching';
    }

    await this.sock.sendMessage(from, {
      text: `📊 *Bot Status*

🎯 Target Group: ${groupName}
💰 Price Markup: ${markupInfo}
📝 Pending Draft: ${hasPending}
⏰ Uptime: Running
🔑 Owner JIDs: ${this.ownerJids.length} configured`
    });
  }

  private async setMarkup(from: string, args: string) {
    const markup = parseInt(args.trim(), 10);

    if (isNaN(markup) || markup < 0) {
      await this.sock.sendMessage(from, {
        text: `❌ Format salah. Contoh: /setmarkup 20000`
      });
      return;
    }

    try {
      const config = await this.aiClient.setMarkup(markup);
      await this.sock.sendMessage(from, {
        text: `✅ Markup harga diubah menjadi: *Rp ${config.price_markup.toLocaleString('id-ID')}*\n\n⚠️ Perubahan ini berlaku sampai restart AI Processor.`
      });
    } catch (error: any) {
      await this.sock.sendMessage(from, {
        text: `❌ Gagal set markup: ${error.message}`
      });
    }
  }

  private async getMarkup(from: string) {
    try {
      const config = await this.aiClient.getConfig();
      await this.sock.sendMessage(from, {
        text: `💰 *Price Markup*: Rp ${config.price_markup.toLocaleString('id-ID')}\n\nGunakan /setmarkup <angka> untuk mengubah.`
      });
    } catch (error: any) {
      await this.sock.sendMessage(from, {
        text: `❌ Gagal ambil config: ${error.message}`
      });
    }
  }

  private async listGroups(from: string) {
    try {
      await this.sock.sendMessage(from, { text: '⏳ Fetching groups...' });

      const groups = await this.sock.groupFetchAllParticipating();
      const groupList = Object.values(groups);

      if (groupList.length === 0) {
        await this.sock.sendMessage(from, { text: '❌ Bot belum join grup manapun.' });
        return;
      }

      let message = `📋 *Groups (${groupList.length}):*\n\n`;
      groupList.forEach((g: any, i: number) => {
        const isTarget = g.id === this.targetGroupJid ? ' ✅' : '';
        message += `${i + 1}. *${g.subject}*${isTarget}\n   \`${g.id}\`\n\n`;
      });

      message += `\n💡 Gunakan /setgroup <JID> untuk set target.`;

      await this.sock.sendMessage(from, { text: message });
    } catch (error: any) {
      logger.error('Failed to fetch groups:', error);
      await this.sock.sendMessage(from, { text: `❌ Error fetching groups: ${error.message}` });
    }
  }

  private async setTargetGroup(from: string, jid: string) {
    if (!jid || !jid.includes('@g.us')) {
      await this.sock.sendMessage(from, {
        text: `❌ Invalid JID. Format: 120363XXXXX@g.us\n\nGunakan /groups untuk lihat JID yang valid.`
      });
      return;
    }

    // Verify the group exists
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const group = groups[jid];

      if (!group) {
        await this.sock.sendMessage(from, {
          text: `❌ Bot tidak ada di grup tersebut.\n\nGunakan /groups untuk lihat grup yang tersedia.`
        });
        return;
      }

      this.targetGroupJid = jid;
      await this.sock.sendMessage(from, {
        text: `✅ Target grup diubah ke:\n*${group.subject}*\n\n⚠️ Ini hanya berlaku sampai restart. Untuk permanen, update TARGET_GROUP_JID di .env`
      });

      logger.info(`Target group changed to: ${jid} (${group.subject})`);
    } catch (error: any) {
      logger.error('Failed to set target group:', error);
      await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
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
    if (!this.pendingState) return false;

    // Check if state is expired (5 minutes)
    if (Date.now() - this.pendingState.timestamp > 5 * 60 * 1000) {
      logger.info('Pending state expired');
      this.clearPendingState();
      return false;
    }

    // STATE 1: Level selection - waiting for 1, 2, or 3
    if (this.pendingState.state === 'level_selection') {
      // Check for numeric level response
      if (['1', '2', '3'].includes(text.trim())) {
        const level = parseInt(text.trim());
        await this.generateDraftWithLevel(from, level);
        return true;
      }

      // Check for CANCEL
      if (text.includes('cancel') || text.includes('batal') || text.includes('skip')) {
        await this.sock.sendMessage(from, { text: '❌ Dibatalkan.' });
        this.clearPendingState();
        return true;
      }

      // Invalid response - remind user
      await this.sock.sendMessage(from, {
        text: '⚠️ Balas dengan angka 1, 2, atau 3 untuk pilih level rekomendasi.'
      });
      return true;
    }

    // STATE 2: Draft pending - waiting for YES/CANCEL
    if (this.pendingState.state === 'draft_pending') {
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
        this.clearPendingState();
        return true;
      }

      // Check for CANCEL response
      if (text.includes('cancel') || text.includes('batal') || text.includes('skip')) {
        await this.sock.sendMessage(from, { text: '❌ Draft dibatalkan.' });
        this.clearPendingState();
        return true;
      }
    }

    return false;
  }

  private async generateDraftWithLevel(from: string, level: number) {
    if (!this.pendingState || !this.pendingState.parsedData) {
      await this.sock.sendMessage(from, { text: '❌ Error: data tidak ditemukan.' });
      this.clearPendingState();
      return;
    }

    try {
      await this.sock.sendMessage(from, { text: `⏳ Generating level ${level} draft...` });

      // Generate with selected level
      const generated = await this.aiClient.generate(
        this.pendingState.parsedData,
        level
      );

      logger.info(`Draft generated with level ${level}`);

      // Update pending state to draft_pending
      this.pendingState.state = 'draft_pending';
      this.pendingState.draft = generated.draft;

      // Send draft with media
      const { mediaPaths } = this.pendingState;
      if (mediaPaths && mediaPaths.length > 0 && fs.existsSync(mediaPaths[0])) {
        await this.sock.sendMessage(from, {
          image: { url: mediaPaths[0] },
          caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      } else {
        await this.sock.sendMessage(from, {
          text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      }
    } catch (error: any) {
      logger.error('Error generating draft:', error);
      await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
      this.clearPendingState();
    }
  }

  private async sendBroadcast(from: string) {
    if (!this.pendingState || !this.pendingState.draft) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada draft yang pending.'
      });
      return;
    }

    if (!this.targetGroupJid) {
      await this.sock.sendMessage(from, {
        text: '❌ TARGET_GROUP_JID belum di-set. Tidak bisa kirim ke grup.'
      });
      this.clearPendingState();
      return;
    }

    try {
      const { draft, mediaPaths } = this.pendingState;

      // Debug logging
      logger.info({
        draftLength: draft?.length || 0,
        draftPreview: draft?.substring(0, 100) || 'EMPTY',
        mediaPathsCount: mediaPaths?.length || 0,
        mediaPaths: mediaPaths,
        mediaExists: mediaPaths?.length > 0 ? fs.existsSync(mediaPaths[0]) : false
      }, 'Sending broadcast to group');

      // Send to target group
      if (mediaPaths && mediaPaths.length > 0 && fs.existsSync(mediaPaths[0])) {
        logger.info('Sending with image...');
        await this.sock.sendMessage(this.targetGroupJid, {
          image: { url: mediaPaths[0] },
          caption: draft || ''
        });
      } else {
        logger.info('Sending text only...');
        await this.sock.sendMessage(this.targetGroupJid, {
          text: draft || '(empty draft)'
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
      this.clearPendingState();
    }
  }

  private async scheduleBroadcast(from: string) {
    // For now, just save to queue - full implementation would use database
    await this.sock.sendMessage(from, {
      text: '📅 Fitur schedule masih dalam pengembangan. Untuk sementara, silakan kirim manual dengan reply YES.'
    });
    // Don't clear pending state so user can still reply YES
  }

  private clearPendingState() {
    if (this.pendingState) {
      // Cleanup any remaining media files
      for (const filepath of this.pendingState.mediaPaths) {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            logger.debug(`Cleaned up media: ${filepath}`);
          }
        } catch (error) {
          logger.error(`Failed to cleanup media ${filepath}:`, error);
        }
      }
      this.pendingState = null;
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

    // Clear any existing pending state
    this.clearPendingState();

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

      // Store pending state for level selection
      this.pendingState = {
        state: 'level_selection',
        parsedData: parsedData,
        mediaPaths: [...mediaPaths],
        timestamp: Date.now()
      };

      // Show level selection with preview
      const levelSelectionMessage = `📚 *${parsedData.title || 'Untitled'}*

Pilih level rekomendasi:

1️⃣ *Standard* - Informatif, light hard-sell
2️⃣ *Recommended* - Persuasif, medium hard-sell  
3️⃣ *Top Pick* ⭐ - Racun belanja! + marker "Top Pick Ahmari Bookstore"

---
Balas dengan angka *1*, *2*, atau *3*`;

      if (mediaPaths.length > 0) {
        await this.sock.sendMessage(from, {
          image: { url: mediaPaths[0] },
          caption: levelSelectionMessage,
        });
      } else {
        await this.sock.sendMessage(from, {
          text: levelSelectionMessage,
        });
      }

      logger.info('Level selection prompt sent');

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
