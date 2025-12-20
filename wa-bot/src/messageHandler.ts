import pino from 'pino';
import { detectFGBBroadcast, DetectionResult } from './detector';
import { AIClient, GenerateResponse, BookSearchResult, BookSearchResponse } from './aiClient';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { loadBaileys, WASocket, proto } from './baileysLoader';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Pending state (simple in-memory for now)
interface PendingState {
  // State: 'level_selection' or 'draft_pending'
  state: 'level_selection' | 'draft_pending';
  rawText?: string;  // Raw FGB text for deferred parsing
  parsedData?: any;  // ParsedBroadcast from AI processor
  mediaPaths: string[];
  draft?: string;
  timestamp: number;
}

// Bulk mode state
interface BulkItem {
  rawText: string;
  parsedData?: any;
  mediaPaths: string[];
  generated?: {
    draft: string;
    error?: string;
  };
}

interface BulkState {
  active: boolean;
  level: number;  // 1, 2, or 3
  items: BulkItem[];
  startedAt: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  // State: 'collecting' | 'preview_pending' | 'sending'
  state: 'collecting' | 'preview_pending' | 'sending';
}

// Research state for /new command (web research flow)
interface ResearchState {
  state: 'search_pending' | 'selection_pending' | 'details_pending' | 'draft_pending';
  query?: string;
  results?: BookSearchResult[];
  selectedBook?: BookSearchResult;
  imagePath?: string;  // Downloaded or user-provided image
  details?: {
    price: number;
    format: string;  // Required, not optional
    eta?: string;
    closeDate?: string;
    minOrder?: string;
  };
  level: number;  // Recommendation level
  draft?: string;
  timestamp: number;
}

// Utility function for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MessageHandler {
  private ownerJids: string[];
  private pendingState: PendingState | null = null;
  private bulkState: BulkState | null = null;
  private researchState: ResearchState | null = null;  // For /new command
  private targetGroupJid: string | null;
  private devGroupJid: string | null;
  private scheduledQueue: Array<{
    title: string;
    scheduledTime: Date;
    targetGroup: 'PRODUCTION' | 'DEV';
  }> = [];

  constructor(
    private sock: WASocket,
    ownerJidOrList: string | string[],
    private aiClient: AIClient,
    private mediaPath: string = './media',
    private baileysPromise = loadBaileys()
  ) {
    this.ownerJids = Array.isArray(ownerJidOrList) ? ownerJidOrList : [ownerJidOrList];
    // Production group (default target)
    this.targetGroupJid = process.env.TARGET_GROUP_JID || '120363420789401477@g.us';
    // Dev/test group
    this.devGroupJid = process.env.DEV_GROUP_JID || '120363335057034362@g.us';

    if (this.targetGroupJid) {
      logger.info(`Target group JID configured: ${this.targetGroupJid}`);
      logger.info(`Dev group JID: ${this.devGroupJid}`);
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

      // Check for bulk state responses (YES/CANCEL/SCHEDULE)
      if (this.bulkState && this.bulkState.state === 'preview_pending') {
        const handled = await this.handleBulkResponse(from, messageText);
        if (handled) return;
      }

      // Check for research state responses (/new flow)
      if (this.researchState) {
        const handled = await this.handleResearchResponse(from, messageText);
        if (handled) return;
      }

      // Detect if this is an FGB broadcast
      const detection = detectFGBBroadcast(message);

      if (detection.isFGBBroadcast) {
        logger.info('FGB broadcast detected!');

        // If bulk mode is active, collect instead of single process
        if (this.bulkState && this.bulkState.state === 'collecting') {
          await this.collectBulkItem(from, message, detection);
        } else {
          await this.processFGBBroadcast(message, detection);
        }
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

        case '/bulk':
          await this.startBulkMode(from, args);
          return true;

        case '/done':
          await this.finishBulkCollection(from);
          return true;

        case '/new':
          await this.startBookResearch(from, args);
          return true;

        case '/queue':
          await this.sendQueueStatus(from);
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

*Bulk Mode:*
/bulk [1|2|3] - Mulai bulk mode (default level 2)
/done - Selesai collect, mulai proses

*Research Mode (Buat dari Nol):*
/new <judul buku> - Cari buku di internet
/queue - Lihat antrian broadcast terjadwal

*Cara pakai (Single):*
1. Forward broadcast FGB ke sini
2. Bot akan generate draft dengan harga +markup
3. Reply YES untuk kirim ke grup

*Cara pakai (Bulk):*
1. Kirim /bulk atau /bulk 3 untuk level racun
2. Forward banyak broadcast FGB
3. Kirim /done untuk proses semua
4. Preview akan muncul, reply YES/SCHEDULE X

*Cara pakai (/new):*
1. Kirim /new Encyclopedia Britannica Kids
2. Pilih buku dengan reply angka
3. Isi detail: 350000 hb jan 26 close 25 dec
4. Review draft, reply YES untuk kirim

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

  private async sendQueueStatus(from: string) {
    // Clean up expired items
    const now = new Date();
    this.scheduledQueue = this.scheduledQueue.filter(item => item.scheduledTime > now);

    if (this.scheduledQueue.length === 0) {
      await this.sock.sendMessage(from, {
        text: '📭 *Antrian Kosong*\n\nTidak ada broadcast terjadwal.'
      });
      return;
    }

    // Sort by scheduled time
    const sorted = this.scheduledQueue.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());

    let queueMsg = `📋 *Antrian Broadcast* (${sorted.length} items)\n\n`;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const minutesLeft = Math.round((item.scheduledTime.getTime() - now.getTime()) / 60000);
      const timeStr = item.scheduledTime.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      });
      const groupIcon = item.targetGroup === 'PRODUCTION' ? '🚀' : '🛠️';

      queueMsg += `${i + 1}. ${item.title}\n`;
      queueMsg += `   ⏰ ${timeStr} (${minutesLeft} menit lagi) ${groupIcon}\n\n`;
    }

    queueMsg += `⚠️ Jadwal hilang jika bot restart.`;

    await this.sock.sendMessage(from, { text: queueMsg });
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
      // Check for YES DEV response (send to dev group)
      if (text === 'yes dev' || text === 'y dev') {
        await this.sendBroadcast(from, this.devGroupJid || undefined);
        return true;
      }

      // Check for YES response (send to production group)
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
    if (!this.pendingState || !this.pendingState.rawText) {
      await this.sock.sendMessage(from, { text: '❌ Error: data tidak ditemukan.' });
      this.clearPendingState();
      return;
    }

    try {
      await this.sock.sendMessage(from, { text: `⏳ Parsing & generating level ${level} draft...` });

      // Parse NOW (after level selection to save 1 API call)
      const parsedData = await this.aiClient.parse(
        this.pendingState.rawText,
        this.pendingState.mediaPaths.length
      );

      logger.info(`Parse successful - format: ${parsedData.format || 'unknown'}`);

      // Generate with selected level
      const generated = await this.aiClient.generate(
        parsedData,
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
          caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      } else {
        await this.sock.sendMessage(from, {
          text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
        });
      }
    } catch (error: any) {
      logger.error('Error generating draft:', error);
      await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
      this.clearPendingState();
    }
  }

  private async sendBroadcast(from: string, targetJid?: string) {
    if (!this.pendingState || !this.pendingState.draft) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada draft yang pending.'
      });
      return;
    }

    // Use provided targetJid or default to production group
    const sendToJid = targetJid || this.targetGroupJid;
    const isDevGroup = targetJid === this.devGroupJid;

    if (!sendToJid) {
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
        mediaExists: mediaPaths?.length > 0 ? fs.existsSync(mediaPaths[0]) : false,
        targetGroup: isDevGroup ? 'DEV' : 'PRODUCTION'
      }, 'Sending broadcast to group');

      // Send to target group
      if (mediaPaths && mediaPaths.length > 0 && fs.existsSync(mediaPaths[0])) {
        logger.info('Sending with image...');
        await this.sock.sendMessage(sendToJid, {
          image: { url: mediaPaths[0] },
          caption: draft || ''
        });
      } else {
        logger.info('Sending text only...');
        await this.sock.sendMessage(sendToJid, {
          text: draft || '(empty draft)'
        });
      }

      logger.info(`Broadcast sent to group: ${sendToJid}`);

      // Confirm to owner with group type
      const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
      await this.sock.sendMessage(from, {
        text: `✅ Broadcast berhasil dikirim ke grup ${groupType}!`
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

      // Store pending state for level selection (NO parsing yet to save tokens)
      this.pendingState = {
        state: 'level_selection',
        rawText: detection.text,  // Store raw text for later parsing
        mediaPaths: [...mediaPaths],
        timestamp: Date.now()
      };

      // Show level selection with generic message
      const levelSelectionMessage = `📚 *Buku Baru Terdeteksi*

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

  // ==================== BULK MODE METHODS ====================

  private async startBulkMode(from: string, args: string) {
    // Parse level from args (default to 2)
    let level = 2;
    if (args.trim()) {
      const parsed = parseInt(args.trim());
      if ([1, 2, 3].includes(parsed)) {
        level = parsed;
      }
    }

    // Clear any existing states
    this.clearPendingState();
    this.clearBulkState();

    // Initialize bulk state
    this.bulkState = {
      active: true,
      level,
      items: [],
      startedAt: Date.now(),
      state: 'collecting'
    };

    // Set 2-minute timeout
    this.bulkState.timeoutId = setTimeout(async () => {
      if (this.bulkState && this.bulkState.state === 'collecting') {
        await this.finishBulkCollection(from);
      }
    }, 2 * 60 * 1000);

    const levelNames = ['', 'Standard', 'Recommended', 'Racun 🔥'];
    await this.sock.sendMessage(from, {
      text: `📦 *Bulk Mode Aktif* (Level ${level}: ${levelNames[level]})

Silakan forward broadcast FGB.
Bot akan mengumpulkan semua message secara diam-diam.

Kirim /done kalau sudah selesai.
(atau otomatis proses setelah 2 menit tanpa aktivitas)`
    });

    logger.info(`Bulk mode started, level ${level}`);
  }

  private async collectBulkItem(
    from: string,
    message: proto.IWebMessageInfo,
    detection: DetectionResult
  ) {
    if (!this.bulkState) return;

    // Reset timeout on each new item
    if (this.bulkState.timeoutId) {
      clearTimeout(this.bulkState.timeoutId);
      this.bulkState.timeoutId = setTimeout(async () => {
        if (this.bulkState && this.bulkState.state === 'collecting') {
          await this.finishBulkCollection(from);
        }
      }, 2 * 60 * 1000);
    }

    const mediaPaths: string[] = [];

    try {
      // Download media if present
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

            let extension = 'bin';
            if (mediaMsg.imageMessage) extension = 'jpg';
            else if (mediaMsg.videoMessage) extension = 'mp4';

            const timestamp = Date.now();
            const filename = `bulk_${timestamp}_${mediaIndex}.${extension}`;
            const filepath = path.join(this.mediaPath, filename);

            await fsPromises.writeFile(filepath, buffer as Buffer);
            mediaPaths.push(filepath);
            mediaIndex++;
          } catch (error) {
            logger.error('Failed to download media in bulk:', error);
          }
        }
      }

      // Add to bulk items
      this.bulkState.items.push({
        rawText: detection.text,
        mediaPaths
      });

      const count = this.bulkState.items.length;
      await this.sock.sendMessage(from, { text: `✓ ${count}` });

      logger.info(`Bulk item ${count} collected`);

    } catch (error: any) {
      logger.error('Error collecting bulk item:', error);
      // Cleanup media on error
      for (const filepath of mediaPaths) {
        try {
          await fsPromises.unlink(filepath);
        } catch (err) {
          logger.error(`Failed to cleanup: ${filepath}`, err);
        }
      }
    }
  }

  private async finishBulkCollection(from: string) {
    if (!this.bulkState) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada bulk mode yang aktif. Gunakan /bulk untuk memulai.'
      });
      return;
    }

    // Clear timeout
    if (this.bulkState.timeoutId) {
      clearTimeout(this.bulkState.timeoutId);
    }

    if (this.bulkState.items.length === 0) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada broadcast yang dikumpulkan. Bulk mode dibatalkan.'
      });
      this.clearBulkState();
      return;
    }

    await this.sock.sendMessage(from, {
      text: `⏳ Memproses ${this.bulkState.items.length} broadcast...`
    });

    await this.processBulkItems(from);
  }

  private async processBulkItems(from: string) {
    if (!this.bulkState) return;

    const level = this.bulkState.level;
    let successCount = 0;
    let failedItems: string[] = [];

    for (let i = 0; i < this.bulkState.items.length; i++) {
      const item = this.bulkState.items[i];

      try {
        // Parse
        const parsedData = await this.aiClient.parse(
          item.rawText,
          item.mediaPaths.length
        );
        item.parsedData = parsedData;

        // Generate
        const generated = await this.aiClient.generate(parsedData, level);
        item.generated = { draft: generated.draft };
        successCount++;

        logger.info(`Bulk item ${i + 1} processed: ${parsedData.title || 'Untitled'}`);

      } catch (error: any) {
        logger.error(`Failed to process bulk item ${i + 1}:`, error);
        item.generated = { draft: '', error: error.message };
        failedItems.push(item.parsedData?.title || `Item ${i + 1}`);
      }
    }

    // Show warning if any failed
    if (failedItems.length > 0) {
      await this.sock.sendMessage(from, {
        text: `⚠️ *Warning*: ${failedItems.length} of ${this.bulkState.items.length} failed to generate\n${failedItems.map(t => `- ❌ "${t}"`).join('\n')}\n\nContinuing with ${successCount} successful broadcasts.`
      });
    }

    if (successCount === 0) {
      await this.sock.sendMessage(from, {
        text: '❌ Semua broadcast gagal diproses. Bulk mode dibatalkan.'
      });
      this.clearBulkState();
      return;
    }

    // Generate and send preview
    this.bulkState.state = 'preview_pending';
    await this.sendBulkPreview(from);
  }

  private async sendBulkPreview(from: string) {
    if (!this.bulkState) return;

    const successItems = this.bulkState.items.filter(
      item => item.generated && !item.generated.error
    );

    const levelNames = ['', 'Standard', 'Recommended', 'Racun 🔥'];
    let preview = `📦 *BULK PREVIEW* (${successItems.length} broadcasts, Level ${this.bulkState.level}: ${levelNames[this.bulkState.level]})\n\n`;

    for (let i = 0; i < successItems.length; i++) {
      const item = successItems[i];
      const title = item.parsedData?.title || 'Untitled';
      const draft = item.generated?.draft || '';

      // Truncate draft for preview (first 200 chars)
      const draftPreview = draft.length > 200
        ? draft.substring(0, 200) + '...'
        : draft;

      preview += `━━━━━━━━━━━━━━━━━━━━\n`;
      preview += `${i + 1}️⃣ *${title}*\n`;
      preview += `${draftPreview}\n\n`;
    }

    preview += `━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `Reply:\n`;
    preview += `• *YES* - Kirim ke PRODUCTION (random 15-30 detik)\n`;
    preview += `• *YES DEV* - Kirim ke DEV\n`;
    preview += `• *SCHEDULE 30* - Jadwalkan ke PRODUCTION tiap 30 menit\n`;
    preview += `• *SCHEDULE DEV 30* - Jadwalkan ke DEV tiap 30 menit\n`;
    preview += `• *CANCEL* - Batalkan semua`;

    // Split message if too long (WhatsApp limit ~4000 chars)
    if (preview.length > 4000) {
      // Send in chunks
      const chunks = preview.match(/.{1,3900}/gs) || [preview];
      for (const chunk of chunks) {
        await this.sock.sendMessage(from, { text: chunk });
      }
    } else {
      await this.sock.sendMessage(from, { text: preview });
    }
  }

  private async handleBulkResponse(from: string, text: string): Promise<boolean> {
    if (!this.bulkState || this.bulkState.state !== 'preview_pending') return false;

    const normalizedText = text.toLowerCase().trim();

    // YES DEV - send to dev group
    if (normalizedText === 'yes dev' || normalizedText === 'y dev') {
      await this.sendBulkBroadcasts(from, this.devGroupJid || undefined);
      return true;
    }

    // YES - send to production group
    if (normalizedText === 'yes' || normalizedText === 'y' || normalizedText === 'ya') {
      await this.sendBulkBroadcasts(from);
      return true;
    }

    // SCHEDULE DEV X - schedule to dev group
    if (normalizedText.startsWith('schedule dev')) {
      const parts = normalizedText.split(/\s+/);
      const minutes = parts[2] ? parseInt(parts[2]) : 30;

      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        await this.sock.sendMessage(from, {
          text: '❌ Interval tidak valid. Contoh: SCHEDULE DEV 30 (untuk 30 menit)'
        });
        return true;
      }

      await this.scheduleBulkBroadcasts(from, minutes, this.devGroupJid || undefined);
      return true;
    }

    // SCHEDULE X - schedule to production group
    if (normalizedText.startsWith('schedule')) {
      const parts = normalizedText.split(/\s+/);
      const minutes = parts[1] ? parseInt(parts[1]) : 30;

      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        await this.sock.sendMessage(from, {
          text: '❌ Interval tidak valid. Contoh: SCHEDULE 30 (untuk 30 menit)'
        });
        return true;
      }

      await this.scheduleBulkBroadcasts(from, minutes);
      return true;
    }

    // CANCEL
    if (normalizedText.includes('cancel') || normalizedText.includes('batal')) {
      await this.sock.sendMessage(from, { text: '❌ Bulk mode dibatalkan.' });
      this.clearBulkState();
      return true;
    }

    return false;
  }

  private async sendBulkBroadcasts(from: string, targetJid?: string) {
    // Use provided targetJid or default to production group
    const sendToJid = targetJid || this.targetGroupJid;
    const isDevGroup = targetJid === this.devGroupJid;

    if (!this.bulkState || !sendToJid) {
      if (!sendToJid) {
        await this.sock.sendMessage(from, {
          text: '❌ TARGET_GROUP_JID belum di-set.'
        });
      }
      this.clearBulkState();
      return;
    }

    this.bulkState.state = 'sending';
    const successItems = this.bulkState.items.filter(
      item => item.generated && !item.generated.error
    );

    const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
    await this.sock.sendMessage(from, {
      text: `⏳ Mengirim ${successItems.length} broadcast ke grup ${groupType}...`
    });

    let sentCount = 0;
    for (let i = 0; i < successItems.length; i++) {
      const item = successItems[i];

      try {
        // Send to group
        if (item.mediaPaths.length > 0 && fs.existsSync(item.mediaPaths[0])) {
          await this.sock.sendMessage(sendToJid, {
            image: { url: item.mediaPaths[0] },
            caption: item.generated?.draft || ''
          });
        } else {
          await this.sock.sendMessage(sendToJid, {
            text: item.generated?.draft || ''
          });
        }

        sentCount++;
        logger.info(`Bulk broadcast ${i + 1}/${successItems.length} sent to ${isDevGroup ? 'DEV' : 'PROD'}`);

        // Random delay 15-30 seconds (except last item)
        if (i < successItems.length - 1) {
          const delay = 15000 + Math.random() * 15000;
          await sleep(delay);
        }

      } catch (error: any) {
        logger.error(`Failed to send bulk item ${i + 1}:`, error);
      }
    }

    await this.sock.sendMessage(from, {
      text: `✅ ${sentCount}/${successItems.length} broadcast terkirim ke grup ${groupType}!`
    });

    this.clearBulkState();
  }

  private async scheduleBulkBroadcasts(from: string, intervalMinutes: number, targetJid?: string) {
    // Use provided targetJid or default to production group
    const sendToJid = targetJid || this.targetGroupJid;
    const isDevGroup = targetJid === this.devGroupJid;

    if (!this.bulkState || !sendToJid) {
      if (!sendToJid) {
        await this.sock.sendMessage(from, {
          text: '❌ TARGET_GROUP_JID belum di-set.'
        });
      }
      this.clearBulkState();
      return;
    }

    const successItems = this.bulkState.items.filter(
      item => item.generated && !item.generated.error
    );

    // Schedule with setTimeout (in-memory, will be lost on restart)
    const schedules: string[] = [];
    const now = new Date();

    for (let i = 0; i < successItems.length; i++) {
      const item = successItems[i];
      const delayMs = i * intervalMinutes * 60 * 1000;
      const scheduledTime = new Date(now.getTime() + delayMs);

      // Capture in closure
      const capturedItem = item;
      const capturedIndex = i;
      const capturedJid = sendToJid;  // Use sendToJid, not this.targetGroupJid
      const sock = this.sock;
      const itemTitle = item.parsedData?.title || 'Untitled';

      // Add to scheduled queue
      this.scheduledQueue.push({
        title: itemTitle,
        scheduledTime: scheduledTime,
        targetGroup: isDevGroup ? 'DEV' : 'PRODUCTION'
      });

      setTimeout(async () => {
        try {
          if (capturedItem.mediaPaths.length > 0 && fs.existsSync(capturedItem.mediaPaths[0])) {
            await sock.sendMessage(capturedJid, {
              image: { url: capturedItem.mediaPaths[0] },
              caption: capturedItem.generated?.draft || ''
            });
          } else {
            await sock.sendMessage(capturedJid, {
              text: capturedItem.generated?.draft || ''
            });
          }
          logger.info(`Scheduled broadcast ${capturedIndex + 1} sent to ${isDevGroup ? 'DEV' : 'PROD'}`);

          // Remove from queue after sending
          this.scheduledQueue = this.scheduledQueue.filter(q =>
            !(q.title === itemTitle && q.scheduledTime.getTime() === scheduledTime.getTime())
          );
        } catch (error) {
          logger.error(`Failed to send scheduled broadcast ${capturedIndex + 1}:`, error);
        }
      }, delayMs);

      const timeStr = scheduledTime.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      });
      schedules.push(`${i + 1}. ${item.parsedData?.title || 'Untitled'} - ${timeStr}`);
    }

    const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
    await this.sock.sendMessage(from, {
      text: `📅 *${successItems.length} broadcast dijadwalkan ke grup ${groupType}*\nInterval: ${intervalMinutes} menit\n\n${schedules.join('\n')}\n\n⚠️ Jadwal hilang jika bot restart.`
    });

    // Clear bulk state but don't cleanup media yet (they'll be sent later)
    // We need to keep media paths accessible
    this.bulkState = null;
  }

  private clearBulkState() {
    if (this.bulkState) {
      // Clear timeout
      if (this.bulkState.timeoutId) {
        clearTimeout(this.bulkState.timeoutId);
      }

      // Cleanup media files (only if not scheduled)
      for (const item of this.bulkState.items) {
        for (const filepath of item.mediaPaths) {
          try {
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
              logger.debug(`Cleaned up bulk media: ${filepath}`);
            }
          } catch (error) {
            logger.error(`Failed to cleanup bulk media ${filepath}:`, error);
          }
        }
      }

      this.bulkState = null;
    }
  }

  // ==================== RESEARCH MODE METHODS (/new) ====================

  private async startBookResearch(from: string, query: string) {
    if (!query.trim()) {
      await this.sock.sendMessage(from, {
        text: `❌ Penggunaan: /new <judul buku>\n\nContoh: /new Encyclopedia Britannica Kids`
      });
      return;
    }

    // Clear any existing states
    this.clearPendingState();
    this.clearBulkState();
    this.clearResearchState();

    try {
      await this.sock.sendMessage(from, {
        text: `🔍 Mencari: "${query}"...\n\nMohon tunggu...`
      });

      // Call AI Processor to search books
      const searchResponse = await this.aiClient.searchBooks(query, 5);

      if (searchResponse.count === 0) {
        await this.sock.sendMessage(from, {
          text: `❌ Tidak ditemukan buku dengan kata kunci "${query}".\n\nCoba kata kunci lain ya!`
        });
        return;
      }

      // Store research state
      this.researchState = {
        state: 'selection_pending',
        query,
        results: searchResponse.results,
        level: 2,  // Default to level 2
        timestamp: Date.now()
      };

      // Build results message
      let resultsMsg = `📚 *Ditemukan ${searchResponse.count} buku:*\n\n`;
      searchResponse.results.forEach((book, i) => {
        const author = book.author ? ` - ${book.author}` : '';
        const publisher = book.publisher ? ` (${book.publisher})` : '';
        resultsMsg += `${i + 1}. *${book.title}*${author}${publisher}\n`;
        if (book.snippet) {
          // Truncate snippet
          const shortSnippet = book.snippet.length > 100
            ? book.snippet.substring(0, 100) + '...'
            : book.snippet;
          resultsMsg += `   _${shortSnippet}_\n`;
        }
        resultsMsg += '\n';
      });

      resultsMsg += `---\nBalas dengan *angka* (1-${searchResponse.count}) untuk pilih buku.\nAtau kirim /cancel untuk batalkan.`;

      await this.sock.sendMessage(from, { text: resultsMsg });

      logger.info(`Book search results shown: ${searchResponse.count} books`);

    } catch (error: any) {
      logger.error('Book search error:', error);
      await this.sock.sendMessage(from, {
        text: `❌ Gagal mencari buku: ${error.message}\n\nPastikan GOOGLE_SEARCH_API_KEY sudah dikonfigurasi.`
      });
      this.clearResearchState();
    }
  }

  private async handleResearchResponse(from: string, text: string): Promise<boolean> {
    if (!this.researchState) return false;

    // Check if state is expired (10 minutes for research)
    if (Date.now() - this.researchState.timestamp > 10 * 60 * 1000) {
      logger.info('Research state expired');
      this.clearResearchState();
      return false;
    }

    // STATE 1: Waiting for book selection (number)
    if (this.researchState.state === 'selection_pending') {
      const num = parseInt(text.trim());

      if (!isNaN(num) && num >= 1 && num <= (this.researchState.results?.length || 0)) {
        const selectedBook = this.researchState.results![num - 1];
        this.researchState.selectedBook = selectedBook;
        this.researchState.state = 'details_pending';
        this.researchState.timestamp = Date.now();

        // Try to download image
        if (selectedBook.image_url) {
          try {
            const imagePath = await this.aiClient.downloadResearchImage(selectedBook.image_url);
            if (imagePath) {
              this.researchState.imagePath = imagePath;
            }
          } catch (e) {
            logger.warn('Failed to download book image:', e);
          }
        }

        await this.sock.sendMessage(from, {
          text: `✅ Dipilih: *${selectedBook.title}*\n${selectedBook.publisher ? `Publisher: ${selectedBook.publisher}\n` : ''}\n📝 *Masukkan detail:*\nFormat: <harga> <format> <eta> close <tanggal>\n\nContoh:\n• 350000 hb jan 26 close 25 dec\n• 250000 pb feb 26\n• 180000 bb\n\n_Harga dalam Rupiah (tanpa "Rp"), format bisa: HB/PB/BB_\n\n---\nAtau kirim /cancel untuk batal`
        });
        return true;
      }

      // Check for cancel
      if (text.includes('cancel') || text.includes('batal')) {
        await this.sock.sendMessage(from, { text: '❌ Pencarian dibatalkan.' });
        this.clearResearchState();
        return true;
      }

      // Invalid selection
      await this.sock.sendMessage(from, {
        text: `⚠️ Pilih angka 1-${this.researchState.results?.length}.\nAtau kirim /cancel untuk batal.`
      });
      return true;
    }

    // STATE 2: Waiting for details (price, format, eta, close)
    if (this.researchState.state === 'details_pending') {
      // Check for cancel
      if (text.includes('cancel') || text.includes('batal')) {
        await this.sock.sendMessage(from, { text: '❌ Pencarian dibatalkan.' });
        this.clearResearchState();
        return true;
      }

      // Parse details: "350000 hb jan 26 close 25 dec"
      const details = this.parseResearchDetails(text);

      if (!details || !details.price) {
        await this.sock.sendMessage(from, {
          text: `⚠️ Format tidak valid.\n\nContoh: 350000 hb jan 26 close 25 dec\n\nMinimum: <harga> (angka)`
        });
        return true;
      }

      this.researchState.details = details;

      // Ask for level
      await this.sock.sendMessage(from, {
        text: `✅ Detail tersimpan:\n💰 Harga: Rp ${details.price.toLocaleString('id-ID')}\n📦 Format: ${details.format || 'HB'}\n📅 ETA: ${details.eta || '-'}\n🔒 Close: ${details.closeDate || '-'}\n\n---\nPilih level rekomendasi:\n\n1️⃣ *Standard* - Informatif\n2️⃣ *Recommended* - Persuasif\n3️⃣ *Top Pick* ⭐ - Racun!\n\nBalas dengan angka *1*, *2*, atau *3*`
      });

      this.researchState.state = 'draft_pending';
      this.researchState.timestamp = Date.now();
      return true;
    }

    // STATE 3: Waiting for level selection, then generate
    if (this.researchState.state === 'draft_pending' && !this.researchState.draft) {
      // Check for level selection
      if (['1', '2', '3'].includes(text.trim())) {
        const level = parseInt(text.trim());
        this.researchState.level = level;

        await this.sock.sendMessage(from, {
          text: `⏳ Generating level ${level} draft...`
        });

        try {
          const generated = await this.aiClient.generateFromResearch({
            book: this.researchState.selectedBook!,
            price_main: this.researchState.details!.price,
            format: this.researchState.details!.format || 'HB',
            eta: this.researchState.details!.eta,
            close_date: this.researchState.details!.closeDate,
            min_order: this.researchState.details!.minOrder,
            level
          });

          this.researchState.draft = generated.draft;

          // Send draft with image if available
          const imagePath = this.researchState.imagePath;
          if (imagePath && fs.existsSync(imagePath)) {
            await this.sock.sendMessage(from, {
              image: { url: imagePath },
              caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *LINKS* - cari link preview lain\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`
            });
          } else {
            await this.sock.sendMessage(from, {
              text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *LINKS* - cari link preview lain\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`
            });
          }

          logger.info('Research draft generated');
          return true;

        } catch (error: any) {
          logger.error('Research generation error:', error);
          await this.sock.sendMessage(from, {
            text: `❌ Gagal generate draft: ${error.message}`
          });
          this.clearResearchState();
          return true;
        }
      }

      // Check for cancel
      if (text.includes('cancel') || text.includes('batal')) {
        await this.sock.sendMessage(from, { text: '❌ Pencarian dibatalkan.' });
        this.clearResearchState();
        return true;
      }

      await this.sock.sendMessage(from, {
        text: '⚠️ Pilih level: 1, 2, atau 3'
      });
      return true;
    }

    // STATE 4: Draft generated, waiting for YES/EDIT/CANCEL
    if (this.researchState.state === 'draft_pending' && this.researchState.draft) {
      // YES DEV - send to dev group
      if (text === 'yes dev' || text === 'y dev') {
        await this.sendResearchBroadcast(from, this.devGroupJid || undefined);
        return true;
      }

      // YES - send to production group
      if (text === 'yes' || text === 'y' || text === 'ya' || text === 'iya') {
        await this.sendResearchBroadcast(from);
        return true;
      }

      // EDIT
      if (text.includes('edit') || text.includes('ubah') || text.includes('ganti')) {
        await this.sock.sendMessage(from, {
          text: '✏️ Silakan edit manual draft-nya lalu forward ulang ke saya ya!'
        });
        this.clearResearchState();
        return true;
      }

      // LINKS - search for additional preview links
      if (text.includes('link')) {
        await this.sock.sendMessage(from, { text: '🔍 Mencari link preview tambahan...' });

        try {
          const bookTitle = this.researchState.selectedBook?.title || '';
          const newLinks = await this.aiClient.searchPreviewLinks(bookTitle, 2);

          if (newLinks.length === 0) {
            await this.sock.sendMessage(from, { text: '❌ Tidak menemukan link preview valid.' });
            return true;
          }

          // Update draft with new links
          const linksSection = newLinks.map(l => `- ${l}`).join('\n');
          const updatedDraft = this.researchState.draft!.replace(
            /Preview:\n[\s\S]*$/,
            `Preview:\n${linksSection}`
          );
          this.researchState.draft = updatedDraft;

          // Re-display updated draft
          const imagePath = this.researchState.imagePath;
          if (imagePath && fs.existsSync(imagePath)) {
            await this.sock.sendMessage(from, {
              image: { url: imagePath },
              caption: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *LINKS* - cari link preview lain\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`
            });
          } else {
            await this.sock.sendMessage(from, {
              text: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *LINKS* - cari link preview lain\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`
            });
          }

          logger.info(`Updated draft with ${newLinks.length} new preview links`);
          return true;

        } catch (error: any) {
          logger.error('Link search error:', error);
          await this.sock.sendMessage(from, { text: `❌ Gagal cari link: ${error.message}` });
          return true;
        }
      }

      // CANCEL
      if (text.includes('cancel') || text.includes('batal') || text.includes('skip')) {
        await this.sock.sendMessage(from, { text: '❌ Draft dibatalkan.' });
        this.clearResearchState();
        return true;
      }
    }

    return false;
  }

  private parseResearchDetails(text: string): {
    price: number;
    format: string;  // Always has a value (defaults to HB)
    eta?: string;
    closeDate?: string;
    minOrder?: string;
  } | null {
    const parts = text.toLowerCase().split(/\s+/);

    if (parts.length === 0) return null;

    // First part should be price
    const price = parseInt(parts[0].replace(/[^\d]/g, ''));
    if (isNaN(price) || price <= 0) return null;

    let format: string | undefined;
    let eta: string | undefined;
    let closeDate: string | undefined;
    let minOrder: string | undefined;

    // Look for format (hb, pb, bb)
    const formatMatch = parts.find(p => ['hb', 'pb', 'bb'].includes(p));
    if (formatMatch) {
      format = formatMatch.toUpperCase();
    }

    // Look for "close" keyword and date after it
    const closeIndex = parts.findIndex(p => p === 'close');
    if (closeIndex !== -1 && closeIndex < parts.length - 1) {
      // Join remaining parts as close date (e.g., "25 dec")
      closeDate = parts.slice(closeIndex + 1, closeIndex + 3).join(' ');
    }

    // Look for month patterns for ETA (jan, feb, mar, etc.)
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== 'close' && months.some(m => parts[i].includes(m))) {
        // Found month, check if next part is year
        const monthPart = parts[i];
        const yearPart = parts[i + 1];

        if (yearPart && /^\d{2,4}$/.test(yearPart)) {
          eta = `${monthPart.charAt(0).toUpperCase() + monthPart.slice(1)} '${yearPart.slice(-2)}`;
        } else {
          eta = monthPart.charAt(0).toUpperCase() + monthPart.slice(1);
        }
        break;
      }
    }

    return { price, format: format || 'HB', eta, closeDate, minOrder };
  }

  private async sendResearchBroadcast(from: string, targetJid?: string) {
    if (!this.researchState || !this.researchState.draft) {
      await this.sock.sendMessage(from, {
        text: '❌ Tidak ada draft yang pending.'
      });
      return;
    }

    // Use provided targetJid or default to production group
    const sendToJid = targetJid || this.targetGroupJid;
    const isDevGroup = targetJid === this.devGroupJid;

    if (!sendToJid) {
      await this.sock.sendMessage(from, {
        text: '❌ TARGET_GROUP_JID belum di-set. Tidak bisa kirim ke grup.'
      });
      this.clearResearchState();
      return;
    }

    try {
      const { draft, imagePath } = this.researchState;

      // Send to target group
      if (imagePath && fs.existsSync(imagePath)) {
        await this.sock.sendMessage(sendToJid, {
          image: { url: imagePath },
          caption: draft || ''
        });
      } else {
        await this.sock.sendMessage(sendToJid, {
          text: draft || '(empty draft)'
        });
      }

      logger.info(`Research broadcast sent to group: ${sendToJid} (${isDevGroup ? 'DEV' : 'PROD'})`);

      const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
      await this.sock.sendMessage(from, {
        text: `✅ Broadcast berhasil dikirim ke grup ${groupType}!`
      });

    } catch (error: any) {
      logger.error('Failed to send research broadcast:', error);
      await this.sock.sendMessage(from, {
        text: `❌ Gagal kirim broadcast: ${error.message}`
      });
    } finally {
      this.clearResearchState();
    }
  }

  private clearResearchState() {
    if (this.researchState) {
      // Cleanup image if exists
      if (this.researchState.imagePath) {
        try {
          if (fs.existsSync(this.researchState.imagePath)) {
            fs.unlinkSync(this.researchState.imagePath);
            logger.debug(`Cleaned up research image: ${this.researchState.imagePath}`);
          }
        } catch (error) {
          logger.error(`Failed to cleanup research image:`, error);
        }
      }
      this.researchState = null;
    }
  }
}
