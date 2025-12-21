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
  state: 'search_pending' | 'selection_pending' | 'image_selection_pending' | 'details_pending' | 'draft_pending';
  query?: string;
  results?: BookSearchResult[];
  selectedBook?: BookSearchResult;
  displayTitle?: string;  // Cleaned display title from AI
  imageOptions?: Array<{ url: string; thumbnail?: string; source?: string }>;  // Available cover images
  imagePath?: string;  // Downloaded or user-provided image
  enrichedDescription?: string;  // Description enriched from multiple sources
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
    draft: string;
    mediaPaths: string[];
    targetJid: string;
    timeoutId: NodeJS.Timeout;
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

      // Handle greeting - show help
      const greetings = ['halo', 'hallo', 'hello', 'hi', 'hai', 'hey'];
      if (greetings.includes(messageText.trim().toLowerCase())) {
        await this.sendHelp(from);
        return;
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

        case '/flush':
          await this.flushQueue(from);
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
/setgroup <prod|dev> <JID> - Set target grup
/setmarkup <angka> - Set markup harga (contoh: 20000)
/getmarkup - Lihat markup harga saat ini
/cancel - Batalkan pending draft

*Bulk Mode:*
/bulk [1|2|3] - Mulai bulk mode (default level 2)
/done - Selesai collect, mulai proses

*Research Mode (Buat dari Nol):*
/new <judul buku> - Cari buku di internet
/queue - Lihat antrian broadcast terjadwal
/flush - Kirim semua antrian SEKARANG (10-15 detik interval)

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
    const hasPending = this.pendingState ? 'Yes' : 'No';

    // Get AI processor config
    let markupInfo = 'N/A';
    try {
      const config = await this.aiClient.getConfig();
      markupInfo = `Rp ${config.price_markup.toLocaleString('id-ID')}`;
    } catch {
      markupInfo = 'Error fetching';
    }

    // Get group names
    let prodGroupName = this.targetGroupJid || 'Not set';
    let devGroupName = this.devGroupJid || 'Not set';
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      if (this.targetGroupJid && groups[this.targetGroupJid]) {
        prodGroupName = `${groups[this.targetGroupJid].subject}\n   \`${this.targetGroupJid}\``;
      }
      if (this.devGroupJid && groups[this.devGroupJid]) {
        devGroupName = `${groups[this.devGroupJid].subject}\n   \`${this.devGroupJid}\``;
      }
    } catch {
      // Keep JID only if can't fetch names
    }

    // Format owner JIDs
    const ownerList = this.ownerJids.map((jid, i) => {
      const num = jid.replace('@lid', '').replace('@s.whatsapp.net', '');
      return `   ${i + 1}. ${num}`;
    }).join('\n');

    await this.sock.sendMessage(from, {
      text: `📊 *Bot Status*

🚀 *Prod Group:*
   ${prodGroupName}

🛠️ *Dev Group:*
   ${devGroupName}

💰 Price Markup: ${markupInfo}
📝 Pending Draft: ${hasPending}
⏰ Uptime: Running

🔑 *Owner JIDs (${this.ownerJids.length}):*
${ownerList}`
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

  private async flushQueue(from: string) {
    if (this.scheduledQueue.length === 0) {
      await this.sock.sendMessage(from, {
        text: '📭 *Antrian Kosong*\n\nTidak ada broadcast untuk di-flush.'
      });
      return;
    }

    const itemsToSend = [...this.scheduledQueue];

    // Cancel all scheduled timeouts
    for (const item of itemsToSend) {
      clearTimeout(item.timeoutId);
    }

    // Clear the queue
    this.scheduledQueue = [];

    await this.sock.sendMessage(from, {
      text: `🚀 *FLUSH MODE*\n\nMengirim ${itemsToSend.length} broadcast sekarang dengan interval 10-15 detik...`
    });

    let sentCount = 0;
    for (let i = 0; i < itemsToSend.length; i++) {
      const item = itemsToSend[i];

      try {
        if (item.mediaPaths.length > 0 && fs.existsSync(item.mediaPaths[0])) {
          await this.sock.sendMessage(item.targetJid, {
            image: { url: item.mediaPaths[0] },
            caption: item.draft
          });
        } else {
          await this.sock.sendMessage(item.targetJid, {
            text: item.draft
          });
        }

        sentCount++;
        const groupIcon = item.targetGroup === 'PRODUCTION' ? '🚀' : '🛠️';
        logger.info(`Flush: sent "${item.title}" to ${item.targetGroup} ${groupIcon}`);

        // Random delay 10-15 seconds (except last item)
        if (i < itemsToSend.length - 1) {
          const delay = 10000 + Math.random() * 5000;
          await sleep(delay);
        }
      } catch (error: any) {
        logger.error(`Flush failed for "${item.title}":`, error);
      }
    }

    await this.sock.sendMessage(from, {
      text: `✅ *FLUSH COMPLETE*\n\n${sentCount}/${itemsToSend.length} broadcast terkirim!`
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

  private async setTargetGroup(from: string, args: string) {
    const parts = args.trim().split(/\s+/);
    const target = parts[0]?.toLowerCase(); // prod or dev
    const jid = parts[1]; // JID

    // Show usage if invalid
    if (!target || !['prod', 'dev'].includes(target) || !jid || !jid.includes('@g.us')) {
      await this.sock.sendMessage(from, {
        text: `❌ *Format:* /setgroup <prod|dev> <JID>

*Contoh:*
/setgroup prod 120363420789401477@g.us
/setgroup dev 120363335057034362@g.us

Gunakan /groups untuk lihat JID yang valid.`
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

      if (target === 'prod') {
        this.targetGroupJid = jid;
        await this.sock.sendMessage(from, {
          text: `✅ *PROD* grup diubah ke:\n*${group.subject}*\n\n⚠️ Berlaku sampai restart. Update TARGET_GROUP_JID di .env untuk permanen.`
        });
        logger.info(`PROD group changed to: ${jid} (${group.subject})`);
      } else {
        this.devGroupJid = jid;
        await this.sock.sendMessage(from, {
          text: `✅ *DEV* grup diubah ke:\n*${group.subject}*\n\n⚠️ Berlaku sampai restart. Update DEV_GROUP_JID di .env untuk permanen.`
        });
        logger.info(`DEV group changed to: ${jid} (${group.subject})`);
      }
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
      const itemDraft = capturedItem.generated?.draft || '';
      const itemMediaPaths = capturedItem.mediaPaths || [];

      // Create timeout and store ID
      const timeoutId = setTimeout(async () => {
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

      // Add to scheduled queue with all data for flush
      this.scheduledQueue.push({
        title: itemTitle,
        scheduledTime: scheduledTime,
        targetGroup: isDevGroup ? 'DEV' : 'PRODUCTION',
        draft: itemDraft,
        mediaPaths: itemMediaPaths,
        targetJid: capturedJid,
        timeoutId: timeoutId
      });

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
      const searchResponse = await this.aiClient.searchBooks(query, 8); // Get more to allow deduplication

      if (searchResponse.count === 0) {
        await this.sock.sendMessage(from, {
          text: `❌ Tidak ditemukan buku dengan kata kunci "${query}".\n\nCoba kata kunci lain ya!`
        });
        return;
      }

      // Deduplicate by cleaned title (keep first occurrence with best data)
      const seenTitles = new Set<string>();
      const deduped = searchResponse.results.filter(book => {
        // Normalize title for deduplication
        const normalizedTitle = book.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenTitles.has(normalizedTitle)) {
          return false;
        }
        seenTitles.add(normalizedTitle);
        return true;
      }).slice(0, 5); // Keep max 5 unique results

      // Store research state with deduplicated results
      this.researchState = {
        state: 'selection_pending',
        query,
        results: deduped,
        level: 2,  // Default to level 2
        timestamp: Date.now()
      };

      // Send intro message
      await this.sock.sendMessage(from, {
        text: `📚 *Ditemukan ${deduped.length} buku:*`
      });

      // Send each result as an image bubble (or text if no image)
      for (let i = 0; i < deduped.length; i++) {
        const book = deduped[i];
        const publisher = book.publisher ? `\nPublisher: ${book.publisher}` : '';
        const caption = `*${i + 1}. ${book.title}*${publisher}`;

        if (book.image_url) {
          try {
            await this.sock.sendMessage(from, {
              image: { url: book.image_url },
              caption
            });
          } catch (e) {
            // Fallback to text if image fails
            await this.sock.sendMessage(from, { text: caption });
          }
        } else {
          await this.sock.sendMessage(from, { text: caption });
        }

        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Send selection prompt
      await this.sock.sendMessage(from, {
        text: `---\nBalas dengan *angka* (1-${deduped.length}) untuk pilih buku.\nAtau kirim /cancel untuk batalkan.`
      });

      logger.info(`Book search results shown: ${deduped.length} books as image bubbles`);

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
        this.researchState.timestamp = Date.now();

        await this.sock.sendMessage(from, { text: '⏳ Mempersiapkan buku...' });

        // Step 1: Get display title (cleaner format)
        try {
          const displayTitle = await this.aiClient.getDisplayTitle(
            selectedBook.title,
            selectedBook.source_url,
            selectedBook.publisher
          );
          this.researchState.displayTitle = displayTitle;
          logger.info(`Display title: ${displayTitle}`);
        } catch (e) {
          logger.warn('Failed to get display title, using raw:', e);
          this.researchState.displayTitle = selectedBook.title;
        }

        // Step 2: Enrich description from multiple sources
        try {
          const enriched = await this.aiClient.enrichDescription(
            selectedBook.title,
            selectedBook.description || selectedBook.snippet || '',
            3
          );
          this.researchState.enrichedDescription = enriched.enrichedDescription;
          logger.info(`Enriched with ${enriched.sourcesUsed} sources`);
        } catch (e) {
          logger.warn('Failed to enrich description:', e);
          this.researchState.enrichedDescription = selectedBook.description || selectedBook.snippet;
        }

        // Step 3: Auto-download first available image (simplified flow)
        if (selectedBook.image_url) {
          try {
            const imagePath = await this.aiClient.downloadResearchImage(selectedBook.image_url);
            if (imagePath) {
              this.researchState.imagePath = imagePath;
              logger.info(`Auto-downloaded cover image: ${imagePath}`);
            }
          } catch (e) {
            logger.warn('Failed to download book image:', e);
          }
        }

        // Go directly to details (image change available at draft stage with COVER option)
        this.researchState.state = 'details_pending';
        const coverStatus = this.researchState.imagePath ? '📷 Cover tersimpan' : '⚠️ Tidak ada cover';
        await this.sock.sendMessage(from, {
          text: `✅ *${this.researchState.displayTitle}*\n${coverStatus}\n\n📝 *Masukkan detail:*\nFormat: <harga> <format> <eta> close <tanggal>\n\nContoh:\n• 350000 hb jan 26 close 25 dec\n• 250000 pb feb 26\n• 180000 bb\n\n_Harga dalam Rupiah (tanpa "Rp"), format bisa: HB/PB/BB_\n\n---\nAtau kirim /cancel untuk batal`
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
          // Create enriched book data for generation
          const enrichedBook = {
            ...this.researchState.selectedBook!,
            // Use display title if available
            title: this.researchState.displayTitle || this.researchState.selectedBook!.title,
            // Use enriched description for better AI context
            description: this.researchState.enrichedDescription || this.researchState.selectedBook!.description
          };

          const generated = await this.aiClient.generateFromResearch({
            book: enrichedBook,
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
              caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
            });
          } else {
            await this.sock.sendMessage(from, {
              text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - pilih cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
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

    // STATE 3.5: Image selection (from COVER option at draft stage)
    if (this.researchState.state === 'image_selection_pending' && this.researchState.draft) {
      const num = parseInt(text.trim());

      if (!isNaN(num) && num >= 0 && num <= (this.researchState.imageOptions?.length || 0)) {
        if (num === 0) {
          // Cancel cover change
          await this.sock.sendMessage(from, { text: '↩️ Cover tidak diganti.' });
        } else {
          // Download selected image
          const selectedImage = this.researchState.imageOptions![num - 1];
          try {
            await this.sock.sendMessage(from, { text: '⬇️ Downloading cover...' });
            const imagePath = await this.aiClient.downloadResearchImage(selectedImage.url);
            if (imagePath) {
              this.researchState.imagePath = imagePath;
              await this.sock.sendMessage(from, { text: '✅ Cover berhasil diganti!' });
            }
          } catch (e) {
            logger.warn('Failed to download selected image:', e);
            await this.sock.sendMessage(from, { text: '❌ Gagal download cover.' });
          }
        }

        // Return to draft_pending and re-display draft
        this.researchState.state = 'draft_pending';
        const imagePath = this.researchState.imagePath;
        if (imagePath && fs.existsSync(imagePath)) {
          await this.sock.sendMessage(from, {
            image: { url: imagePath },
            caption: `📝 *DRAFT BROADCAST*\n\n${this.researchState.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
          });
        } else {
          await this.sock.sendMessage(from, {
            text: `📝 *DRAFT BROADCAST*\n\n${this.researchState.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - pilih cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
          });
        }
        return true;
      }

      // Check for cancel
      if (text.includes('cancel') || text.includes('batal')) {
        this.researchState.state = 'draft_pending';
        await this.sock.sendMessage(from, { text: '↩️ Cover tidak diganti.' });
        return true;
      }

      // Invalid selection
      await this.sock.sendMessage(from, {
        text: `⚠️ Pilih angka 0-${this.researchState.imageOptions?.length}.`
      });
      return true;
    }

    // STATE 4: Draft generated, waiting for YES/EDIT/CANCEL/etc.
    if (this.researchState.state === 'draft_pending' && this.researchState.draft) {
      // Map number selection to commands: 1=YES, 2=YES DEV, 3=COVER, 4=LINKS, 5=REGEN, 6=EDIT, 7=CANCEL
      const numMap: { [key: string]: string } = { '1': 'yes', '2': 'yes dev', '3': 'cover', '4': 'links', '5': 'regen', '6': 'edit', '7': 'cancel' };
      const mappedText = numMap[text.trim()] || text;

      // 1. YES - send to production group
      if (mappedText === 'yes' || mappedText === 'y' || mappedText === 'ya' || mappedText === 'iya') {
        await this.sendResearchBroadcast(from);
        return true;
      }

      // 2. YES DEV - send to dev group
      if (mappedText === 'yes dev' || mappedText === 'y dev') {
        await this.sendResearchBroadcast(from, this.devGroupJid || undefined);
        return true;
      }

      // 5. REGEN - regenerate description with same level
      if (mappedText === 'regen' || mappedText.includes('regen') || mappedText.includes('ulang')) {
        await this.sock.sendMessage(from, { text: '🔄 Regenerating description...' });

        try {
          const enrichedBook = {
            ...this.researchState.selectedBook!,
            title: this.researchState.displayTitle || this.researchState.selectedBook!.title,
            description: this.researchState.enrichedDescription || this.researchState.selectedBook!.description
          };

          const generated = await this.aiClient.generateFromResearch({
            book: enrichedBook,
            price_main: this.researchState.details!.price,
            format: this.researchState.details!.format || 'HB',
            eta: this.researchState.details!.eta,
            close_date: this.researchState.details!.closeDate,
            min_order: this.researchState.details!.minOrder,
            level: this.researchState.level || 2
          });

          this.researchState.draft = generated.draft;

          // Re-display with new draft
          const imagePath = this.researchState.imagePath;
          const optionsText = `---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`;

          if (imagePath && fs.existsSync(imagePath)) {
            await this.sock.sendMessage(from, {
              image: { url: imagePath },
              caption: `📝 *DRAFT BROADCAST (Regenerated)*\n\n${generated.draft}\n\n${optionsText}`
            });
          } else {
            await this.sock.sendMessage(from, {
              text: `📝 *DRAFT BROADCAST (Regenerated)*\n\n${generated.draft}\n\n${optionsText}`
            });
          }
          return true;
        } catch (error: any) {
          await this.sock.sendMessage(from, { text: `❌ Gagal regenerate: ${error.message}` });
          return true;
        }
      }

      // 6. EDIT
      if (mappedText === 'edit' || mappedText.includes('ubah')) {
        await this.sock.sendMessage(from, {
          text: '✏️ Silakan edit manual draft-nya lalu forward ulang ke saya ya!'
        });
        this.clearResearchState();
        return true;
      }

      // 3. COVER - search for new cover images
      if (mappedText === 'cover' || mappedText.includes('cover')) {
        await this.sock.sendMessage(from, { text: '🔍 Mencari cover image...' });

        try {
          const bookTitle = this.researchState.selectedBook?.title || '';
          const images = await this.aiClient.searchImages(bookTitle, 5);

          if (images.length === 0) {
            await this.sock.sendMessage(from, { text: '❌ Tidak menemukan cover image.' });
            return true;
          }

          // Store image options and enter image selection mode
          this.researchState.imageOptions = images;

          let imgMsg = `📷 *Pilih cover image:*\n\n`;
          images.forEach((img, i) => {
            imgMsg += `${i + 1}. ${img.source || 'image'} (${img.width}x${img.height})\n`;
          });
          imgMsg += `\n0. Batalkan ganti cover\n\n---\nBalas dengan angka (0-${images.length})`;

          await this.sock.sendMessage(from, { text: imgMsg });

          // Set a flag to indicate we're waiting for image selection
          this.researchState.state = 'image_selection_pending';
          return true;

        } catch (error: any) {
          logger.error('Cover search error:', error);
          await this.sock.sendMessage(from, { text: `❌ Gagal cari cover: ${error.message}` });
          return true;
        }
      }

      // 4. LINKS - search for additional preview links
      if (mappedText === 'links' || mappedText.includes('link')) {
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
              caption: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
            });
          } else {
            await this.sock.sendMessage(from, {
              text: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - pilih cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
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

      // 7. CANCEL
      if (mappedText === 'cancel' || mappedText.includes('batal') || mappedText.includes('skip')) {
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
