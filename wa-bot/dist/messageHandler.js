"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
const pino_1 = __importDefault(require("pino"));
const detector_1 = require("./detector");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const fs_2 = require("fs");
const baileysLoader_1 = require("./baileysLoader");
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
// Utility function for delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class MessageHandler {
    constructor(sock, ownerJidOrList, aiClient, mediaPath = './media', baileysPromise = (0, baileysLoader_1.loadBaileys)()) {
        this.sock = sock;
        this.aiClient = aiClient;
        this.mediaPath = mediaPath;
        this.baileysPromise = baileysPromise;
        this.pendingState = null;
        this.bulkState = null;
        this.ownerJids = Array.isArray(ownerJidOrList) ? ownerJidOrList : [ownerJidOrList];
        this.targetGroupJid = process.env.TARGET_GROUP_JID || null;
        if (this.targetGroupJid) {
            logger.info(`Target group JID configured: ${this.targetGroupJid}`);
        }
        else {
            logger.warn('TARGET_GROUP_JID not set - broadcast sending disabled');
        }
        // Ensure media directory exists
        if (!fs_1.default.existsSync(mediaPath)) {
            fs_1.default.mkdirSync(mediaPath, { recursive: true });
        }
    }
    async handleMessage(message) {
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
                if (handled)
                    return;
            }
            // Check for pending state responses 
            if (this.pendingState) {
                logger.info('Checking pending response...');
                const handled = await this.handlePendingResponse(from, messageText);
                if (handled)
                    return;
            }
            // Check for bulk state responses (YES/CANCEL/SCHEDULE)
            if (this.bulkState && this.bulkState.state === 'preview_pending') {
                const handled = await this.handleBulkResponse(from, messageText);
                if (handled)
                    return;
            }
            // Detect if this is an FGB broadcast
            const detection = (0, detector_1.detectFGBBroadcast)(message);
            if (detection.isFGBBroadcast) {
                logger.info('FGB broadcast detected!');
                // If bulk mode is active, collect instead of single process
                if (this.bulkState && this.bulkState.state === 'collecting') {
                    await this.collectBulkItem(from, message, detection);
                }
                else {
                    await this.processFGBBroadcast(message, detection);
                }
            }
            else {
                logger.debug('Not an FGB broadcast, ignoring');
            }
        }
        catch (error) {
            logger.error('Error handling message:', error);
        }
    }
    async handleSlashCommand(from, text) {
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
                default:
                    return false;
            }
        }
        catch (error) {
            logger.error(`Error handling command ${command}:`, error);
            await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
            return true;
        }
    }
    async sendHelp(from) {
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

*Cara pakai (Single):*
1. Forward broadcast FGB ke sini
2. Bot akan generate draft dengan harga +markup
3. Reply YES untuk kirim ke grup

*Cara pakai (Bulk):*
1. Kirim /bulk atau /bulk 3 untuk level racun
2. Forward banyak broadcast FGB
3. Kirim /done untuk proses semua
4. Preview akan muncul, reply YES/SCHEDULE X

*Tips:*
- JID grup format: 120363XXXXX@g.us
- Gunakan /groups untuk lihat JID`
        });
    }
    async sendStatus(from) {
        const groupName = this.targetGroupJid || 'Not set';
        const hasPending = this.pendingState ? 'Yes' : 'No';
        // Get AI processor config
        let markupInfo = 'N/A';
        try {
            const config = await this.aiClient.getConfig();
            markupInfo = `Rp ${config.price_markup.toLocaleString('id-ID')}`;
        }
        catch {
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
    async setMarkup(from, args) {
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
        }
        catch (error) {
            await this.sock.sendMessage(from, {
                text: `❌ Gagal set markup: ${error.message}`
            });
        }
    }
    async getMarkup(from) {
        try {
            const config = await this.aiClient.getConfig();
            await this.sock.sendMessage(from, {
                text: `💰 *Price Markup*: Rp ${config.price_markup.toLocaleString('id-ID')}\n\nGunakan /setmarkup <angka> untuk mengubah.`
            });
        }
        catch (error) {
            await this.sock.sendMessage(from, {
                text: `❌ Gagal ambil config: ${error.message}`
            });
        }
    }
    async listGroups(from) {
        try {
            await this.sock.sendMessage(from, { text: '⏳ Fetching groups...' });
            const groups = await this.sock.groupFetchAllParticipating();
            const groupList = Object.values(groups);
            if (groupList.length === 0) {
                await this.sock.sendMessage(from, { text: '❌ Bot belum join grup manapun.' });
                return;
            }
            let message = `📋 *Groups (${groupList.length}):*\n\n`;
            groupList.forEach((g, i) => {
                const isTarget = g.id === this.targetGroupJid ? ' ✅' : '';
                message += `${i + 1}. *${g.subject}*${isTarget}\n   \`${g.id}\`\n\n`;
            });
            message += `\n💡 Gunakan /setgroup <JID> untuk set target.`;
            await this.sock.sendMessage(from, { text: message });
        }
        catch (error) {
            logger.error('Failed to fetch groups:', error);
            await this.sock.sendMessage(from, { text: `❌ Error fetching groups: ${error.message}` });
        }
    }
    async setTargetGroup(from, jid) {
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
        }
        catch (error) {
            logger.error('Failed to set target group:', error);
            await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
        }
    }
    extractMessageText(message) {
        const content = message.message;
        if (!content)
            return '';
        return (content.conversation ||
            content.extendedTextMessage?.text ||
            content.imageMessage?.caption ||
            '').toLowerCase().trim();
    }
    async handlePendingResponse(from, text) {
        if (!this.pendingState)
            return false;
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
    async generateDraftWithLevel(from, level) {
        if (!this.pendingState || !this.pendingState.rawText) {
            await this.sock.sendMessage(from, { text: '❌ Error: data tidak ditemukan.' });
            this.clearPendingState();
            return;
        }
        try {
            await this.sock.sendMessage(from, { text: `⏳ Parsing & generating level ${level} draft...` });
            // Parse NOW (after level selection to save 1 API call)
            const parsedData = await this.aiClient.parse(this.pendingState.rawText, this.pendingState.mediaPaths.length);
            logger.info(`Parse successful - format: ${parsedData.format || 'unknown'}`);
            // Generate with selected level
            const generated = await this.aiClient.generate(parsedData, level);
            logger.info(`Draft generated with level ${level}`);
            // Update pending state to draft_pending
            this.pendingState.state = 'draft_pending';
            this.pendingState.draft = generated.draft;
            // Send draft with media
            const { mediaPaths } = this.pendingState;
            if (mediaPaths && mediaPaths.length > 0 && fs_1.default.existsSync(mediaPaths[0])) {
                await this.sock.sendMessage(from, {
                    image: { url: mediaPaths[0] },
                    caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
                });
            }
            else {
                await this.sock.sendMessage(from, {
                    text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup sekarang\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
                });
            }
        }
        catch (error) {
            logger.error('Error generating draft:', error);
            await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
            this.clearPendingState();
        }
    }
    async sendBroadcast(from) {
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
                mediaExists: mediaPaths?.length > 0 ? fs_1.default.existsSync(mediaPaths[0]) : false
            }, 'Sending broadcast to group');
            // Send to target group
            if (mediaPaths && mediaPaths.length > 0 && fs_1.default.existsSync(mediaPaths[0])) {
                logger.info('Sending with image...');
                await this.sock.sendMessage(this.targetGroupJid, {
                    image: { url: mediaPaths[0] },
                    caption: draft || ''
                });
            }
            else {
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
        }
        catch (error) {
            logger.error('Failed to send broadcast:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal kirim broadcast: ${error.message}`
            });
        }
        finally {
            this.clearPendingState();
        }
    }
    async scheduleBroadcast(from) {
        // For now, just save to queue - full implementation would use database
        await this.sock.sendMessage(from, {
            text: '📅 Fitur schedule masih dalam pengembangan. Untuk sementara, silakan kirim manual dengan reply YES.'
        });
        // Don't clear pending state so user can still reply YES
    }
    clearPendingState() {
        if (this.pendingState) {
            // Cleanup any remaining media files
            for (const filepath of this.pendingState.mediaPaths) {
                try {
                    if (fs_1.default.existsSync(filepath)) {
                        fs_1.default.unlinkSync(filepath);
                        logger.debug(`Cleaned up media: ${filepath}`);
                    }
                }
                catch (error) {
                    logger.error(`Failed to cleanup media ${filepath}:`, error);
                }
            }
            this.pendingState = null;
        }
    }
    async processFGBBroadcast(message, detection) {
        const from = message.key.remoteJid;
        if (!from) {
            logger.warn('processFGBBroadcast called with no remoteJid');
            return;
        }
        // Clear any existing pending state
        this.clearPendingState();
        const mediaPaths = [];
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
                        const buffer = await downloadMediaMessage({ message: mediaMsg }, 'buffer', {});
                        // Determine file extension from media type
                        let extension = 'bin';
                        if (mediaMsg.imageMessage) {
                            extension = 'jpg';
                        }
                        else if (mediaMsg.videoMessage) {
                            extension = 'mp4';
                        }
                        // Save media file with unique filename (async)
                        const timestamp = Date.now();
                        const filename = `fgb_${timestamp}_${mediaIndex}.${extension}`;
                        const filepath = path_1.default.join(this.mediaPath, filename);
                        await fs_2.promises.writeFile(filepath, buffer);
                        mediaPaths.push(filepath);
                        logger.info(`Media saved: ${filepath}`);
                        mediaIndex++;
                    }
                    catch (error) {
                        logger.error('Failed to download media:', error);
                    }
                }
            }
            // Store pending state for level selection (NO parsing yet to save tokens)
            this.pendingState = {
                state: 'level_selection',
                rawText: detection.text, // Store raw text for later parsing
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
            }
            else {
                await this.sock.sendMessage(from, {
                    text: levelSelectionMessage,
                });
            }
            logger.info('Level selection prompt sent');
            // DON'T cleanup media yet - wait for YES response
        }
        catch (error) {
            logger.error('Error processing FGB broadcast:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Error: ${error.message}\n\nSilakan coba lagi.`,
            });
            // Cleanup on error
            for (const filepath of mediaPaths) {
                try {
                    await fs_2.promises.unlink(filepath);
                    logger.debug(`Cleaned up media: ${filepath}`);
                }
                catch (err) {
                    logger.error(`Failed to cleanup media ${filepath}:`, err);
                }
            }
        }
    }
    // ==================== BULK MODE METHODS ====================
    async startBulkMode(from, args) {
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
    async collectBulkItem(from, message, detection) {
        if (!this.bulkState)
            return;
        // Reset timeout on each new item
        if (this.bulkState.timeoutId) {
            clearTimeout(this.bulkState.timeoutId);
            this.bulkState.timeoutId = setTimeout(async () => {
                if (this.bulkState && this.bulkState.state === 'collecting') {
                    await this.finishBulkCollection(from);
                }
            }, 2 * 60 * 1000);
        }
        const mediaPaths = [];
        try {
            // Download media if present
            if (detection.hasMedia && detection.mediaMessages.length > 0) {
                const { downloadMediaMessage } = await this.baileysPromise;
                let mediaIndex = 0;
                for (const mediaMsg of detection.mediaMessages) {
                    try {
                        const buffer = await downloadMediaMessage({ message: mediaMsg }, 'buffer', {});
                        let extension = 'bin';
                        if (mediaMsg.imageMessage)
                            extension = 'jpg';
                        else if (mediaMsg.videoMessage)
                            extension = 'mp4';
                        const timestamp = Date.now();
                        const filename = `bulk_${timestamp}_${mediaIndex}.${extension}`;
                        const filepath = path_1.default.join(this.mediaPath, filename);
                        await fs_2.promises.writeFile(filepath, buffer);
                        mediaPaths.push(filepath);
                        mediaIndex++;
                    }
                    catch (error) {
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
        }
        catch (error) {
            logger.error('Error collecting bulk item:', error);
            // Cleanup media on error
            for (const filepath of mediaPaths) {
                try {
                    await fs_2.promises.unlink(filepath);
                }
                catch (err) {
                    logger.error(`Failed to cleanup: ${filepath}`, err);
                }
            }
        }
    }
    async finishBulkCollection(from) {
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
    async processBulkItems(from) {
        if (!this.bulkState)
            return;
        const level = this.bulkState.level;
        let successCount = 0;
        let failedItems = [];
        for (let i = 0; i < this.bulkState.items.length; i++) {
            const item = this.bulkState.items[i];
            try {
                // Parse
                const parsedData = await this.aiClient.parse(item.rawText, item.mediaPaths.length);
                item.parsedData = parsedData;
                // Generate
                const generated = await this.aiClient.generate(parsedData, level);
                item.generated = { draft: generated.draft };
                successCount++;
                logger.info(`Bulk item ${i + 1} processed: ${parsedData.title || 'Untitled'}`);
            }
            catch (error) {
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
    async sendBulkPreview(from) {
        if (!this.bulkState)
            return;
        const successItems = this.bulkState.items.filter(item => item.generated && !item.generated.error);
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
        preview += `• *YES* - Kirim semua sekarang (random 15-30 detik)\n`;
        preview += `• *SCHEDULE 30* - Jadwalkan tiap 30 menit\n`;
        preview += `• *CANCEL* - Batalkan semua`;
        // Split message if too long (WhatsApp limit ~4000 chars)
        if (preview.length > 4000) {
            // Send in chunks
            const chunks = preview.match(/.{1,3900}/gs) || [preview];
            for (const chunk of chunks) {
                await this.sock.sendMessage(from, { text: chunk });
            }
        }
        else {
            await this.sock.sendMessage(from, { text: preview });
        }
    }
    async handleBulkResponse(from, text) {
        if (!this.bulkState || this.bulkState.state !== 'preview_pending')
            return false;
        const normalizedText = text.toLowerCase().trim();
        // YES - send immediately
        if (normalizedText === 'yes' || normalizedText === 'y' || normalizedText === 'ya') {
            await this.sendBulkBroadcasts(from);
            return true;
        }
        // SCHEDULE X
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
    async sendBulkBroadcasts(from) {
        if (!this.bulkState || !this.targetGroupJid) {
            if (!this.targetGroupJid) {
                await this.sock.sendMessage(from, {
                    text: '❌ TARGET_GROUP_JID belum di-set.'
                });
            }
            this.clearBulkState();
            return;
        }
        this.bulkState.state = 'sending';
        const successItems = this.bulkState.items.filter(item => item.generated && !item.generated.error);
        await this.sock.sendMessage(from, {
            text: `⏳ Mengirim ${successItems.length} broadcast ke grup...`
        });
        let sentCount = 0;
        for (let i = 0; i < successItems.length; i++) {
            const item = successItems[i];
            try {
                // Send to group
                if (item.mediaPaths.length > 0 && fs_1.default.existsSync(item.mediaPaths[0])) {
                    await this.sock.sendMessage(this.targetGroupJid, {
                        image: { url: item.mediaPaths[0] },
                        caption: item.generated?.draft || ''
                    });
                }
                else {
                    await this.sock.sendMessage(this.targetGroupJid, {
                        text: item.generated?.draft || ''
                    });
                }
                sentCount++;
                logger.info(`Bulk broadcast ${i + 1}/${successItems.length} sent`);
                // Random delay 15-30 seconds (except last item)
                if (i < successItems.length - 1) {
                    const delay = 15000 + Math.random() * 15000;
                    await sleep(delay);
                }
            }
            catch (error) {
                logger.error(`Failed to send bulk item ${i + 1}:`, error);
            }
        }
        await this.sock.sendMessage(from, {
            text: `✅ ${sentCount}/${successItems.length} broadcast terkirim ke grup!`
        });
        this.clearBulkState();
    }
    async scheduleBulkBroadcasts(from, intervalMinutes) {
        if (!this.bulkState || !this.targetGroupJid) {
            if (!this.targetGroupJid) {
                await this.sock.sendMessage(from, {
                    text: '❌ TARGET_GROUP_JID belum di-set.'
                });
            }
            this.clearBulkState();
            return;
        }
        const successItems = this.bulkState.items.filter(item => item.generated && !item.generated.error);
        // Schedule with setTimeout (in-memory, will be lost on restart)
        const schedules = [];
        const now = new Date();
        for (let i = 0; i < successItems.length; i++) {
            const item = successItems[i];
            const delayMs = i * intervalMinutes * 60 * 1000;
            const scheduledTime = new Date(now.getTime() + delayMs);
            // Capture in closure
            const capturedItem = item;
            const capturedIndex = i;
            const targetJid = this.targetGroupJid;
            const sock = this.sock;
            setTimeout(async () => {
                try {
                    if (capturedItem.mediaPaths.length > 0 && fs_1.default.existsSync(capturedItem.mediaPaths[0])) {
                        await sock.sendMessage(targetJid, {
                            image: { url: capturedItem.mediaPaths[0] },
                            caption: capturedItem.generated?.draft || ''
                        });
                    }
                    else {
                        await sock.sendMessage(targetJid, {
                            text: capturedItem.generated?.draft || ''
                        });
                    }
                    logger.info(`Scheduled broadcast ${capturedIndex + 1} sent`);
                }
                catch (error) {
                    logger.error(`Failed to send scheduled broadcast ${capturedIndex + 1}:`, error);
                }
            }, delayMs);
            const timeStr = scheduledTime.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
            });
            schedules.push(`${i + 1}. ${item.parsedData?.title || 'Untitled'} - ${timeStr}`);
        }
        await this.sock.sendMessage(from, {
            text: `📅 *${successItems.length} broadcast dijadwalkan*\nInterval: ${intervalMinutes} menit\n\n${schedules.join('\n')}\n\n⚠️ Jadwal hilang jika bot restart.`
        });
        // Clear bulk state but don't cleanup media yet (they'll be sent later)
        // We need to keep media paths accessible
        this.bulkState = null;
    }
    clearBulkState() {
        if (this.bulkState) {
            // Clear timeout
            if (this.bulkState.timeoutId) {
                clearTimeout(this.bulkState.timeoutId);
            }
            // Cleanup media files (only if not scheduled)
            for (const item of this.bulkState.items) {
                for (const filepath of item.mediaPaths) {
                    try {
                        if (fs_1.default.existsSync(filepath)) {
                            fs_1.default.unlinkSync(filepath);
                            logger.debug(`Cleaned up bulk media: ${filepath}`);
                        }
                    }
                    catch (error) {
                        logger.error(`Failed to cleanup bulk media ${filepath}:`, error);
                    }
                }
            }
            this.bulkState = null;
        }
    }
}
exports.MessageHandler = MessageHandler;
