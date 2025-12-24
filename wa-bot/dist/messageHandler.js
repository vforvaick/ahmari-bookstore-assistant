"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
const pino_1 = __importDefault(require("pino"));
const detector_1 = require("./detector");
const stateStore_1 = require("./stateStore");
const draftCommands_1 = require("./draftCommands");
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
        this.researchState = null; // For /new command
        // posterState removed (deprecated)
        this.captionState = null; // For /caption command
        this.scheduledQueue = [];
        this.ownerJids = Array.isArray(ownerJidOrList) ? ownerJidOrList : [ownerJidOrList];
        // Production group (default target)
        this.targetGroupJid = process.env.TARGET_GROUP_JID || '120363420789401477@g.us';
        // Dev/test group
        this.devGroupJid = process.env.DEV_GROUP_JID || '120363335057034362@g.us';
        if (this.targetGroupJid) {
            logger.info(`Target group JID configured: ${this.targetGroupJid}`);
            logger.info(`Dev group JID: ${this.devGroupJid}`);
        }
        else {
            logger.warn('TARGET_GROUP_JID not set - broadcast sending disabled');
        }
        // Ensure media directory exists
        if (!fs_1.default.existsSync(mediaPath)) {
            fs_1.default.mkdirSync(mediaPath, { recursive: true });
        }
    }
    // ==================== STATE PERSISTENCE HELPERS ====================
    /**
     * Load all states for a user from persistent storage
     * Call at the beginning of handleMessage
     */
    loadUserStates(userJid) {
        const store = (0, stateStore_1.getStateStore)();
        this.pendingState = store.getState(userJid, 'pending');
        this.bulkState = store.getState(userJid, 'bulk');
        this.researchState = store.getState(userJid, 'research');
        this.captionState = store.getState(userJid, 'caption');
    }
    /**
     * Save a specific state type to persistent storage
     * @param ttlMinutes - Time to live in minutes (default 10)
     */
    saveState(userJid, type, state, ttlMinutes = 10) {
        const store = (0, stateStore_1.getStateStore)();
        if (state) {
            store.setState(userJid, type, state, ttlMinutes);
        }
        else {
            store.clearState(userJid, type);
        }
    }
    /**
     * Clear a specific state type
     */
    clearPersistedState(userJid, type) {
        const store = (0, stateStore_1.getStateStore)();
        store.clearState(userJid, type);
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
            // Load persisted states for this user (survives restarts)
            this.loadUserStates(from);
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
                if (handled)
                    return;
            }
            // Check for bulk state responses (YES/CANCEL/SCHEDULE)
            if (this.bulkState && this.bulkState.state === 'preview_pending') {
                const handled = await this.handleBulkResponse(from, messageText);
                if (handled)
                    return;
            }
            // Check for research state responses (/new flow)
            if (this.researchState) {
                const handled = await this.handleResearchResponse(from, messageText);
                if (handled)
                    return;
            }
            // posterState check removed (deprecated)
            // Check for caption state responses (/caption flow)
            if (this.captionState) {
                const handled = await this.handleCaptionResponse(from, messageText, message);
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
            else if (detection.hasMedia && !detection.text.trim()) {
                // Image-only message (no FGB caption) → trigger caption flow
                logger.info('Image-only message detected, starting caption flow');
                await this.startCaptionModeWithImage(from, message);
            }
            else {
                logger.debug('Not an FGB broadcast or image-only, ignoring');
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
                    this.clearPendingState(from);
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
                case '/supplier':
                    await this.setSupplier(from, args);
                    return true;
                // /poster removed (deprecated)
                // /caption removed - now auto-detected from image-only messages
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
            text: `🤖 *Ahmari Bookstore Bot*

📖 *BUAT PROMO*
• Forward broadcast FGB → langsung generate!
• Kirim gambar cover → generate dari gambar!
• /new <judul buku>
  Contoh: /new Atomic Habits
  → Cari di internet → pilih hasil → isi harga → draft
• /bulk [level]
  Contoh: /bulk 2 atau /bulk 3
  Level: 1=standar, 2=rekomendasi, 3=racun
  → Forward banyak → ketik /done → proses semua



📅 *JADWAL*
• /queue → lihat antrian broadcast
• /flush → kirim semua antrian SEKARANG
• /cancel → batalkan draft/state pending

⚙️ *ADMIN*
• /status → info bot & config
• /setmarkup <angka> → contoh: /setmarkup 25000
• /groups → list semua grup
• /setgroup <prod|dev> <JID>`
        });
    }
    async sendStatus(from) {
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
        }
        catch {
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
    async sendQueueStatus(from) {
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
    async flushQueue(from) {
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
                if (item.mediaPaths.length > 0 && fs_1.default.existsSync(item.mediaPaths[0])) {
                    await this.sock.sendMessage(item.targetJid, {
                        image: { url: item.mediaPaths[0] },
                        caption: item.draft
                    });
                }
                else {
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
            }
            catch (error) {
                logger.error(`Flush failed for "${item.title}":`, error);
            }
        }
        await this.sock.sendMessage(from, {
            text: `✅ *FLUSH COMPLETE*\n\n${sentCount}/${itemsToSend.length} broadcast terkirim!`
        });
    }
    /**
     * Set supplier type for parsing (FGB or Littlerazy)
     */
    async setSupplier(from, args) {
        const supplier = args.trim().toLowerCase();
        if (supplier !== 'fgb' && supplier !== 'littlerazy') {
            await this.sock.sendMessage(from, {
                text: `❌ Supplier tidak dikenal.\n\nPilihan: */supplier fgb* atau */supplier littlerazy*`
            });
            return;
        }
        // Update bulk state if active
        if (this.bulkState && this.bulkState.state === 'collecting') {
            this.bulkState.supplierType = supplier;
            await this.sock.sendMessage(from, {
                text: `✅ Supplier diubah ke *${supplier.toUpperCase()}*\n\nSemua broadcast akan diproses dengan parser ${supplier}.`
            });
            return;
        }
        // Update pending state if active
        if (this.pendingState) {
            this.pendingState.supplierType = supplier;
            await this.sock.sendMessage(from, {
                text: `✅ Supplier diubah ke *${supplier.toUpperCase()}*`
            });
            return;
        }
        await this.sock.sendMessage(from, {
            text: `ℹ️ Tidak ada mode aktif.\n\nGunakan /supplier saat bulk mode atau setelah forward broadcast.`
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
    async setTargetGroup(from, args) {
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
            }
            else {
                this.devGroupJid = jid;
                await this.sock.sendMessage(from, {
                    text: `✅ *DEV* grup diubah ke:\n*${group.subject}*\n\n⚠️ Berlaku sampai restart. Update DEV_GROUP_JID di .env untuk permanen.`
                });
                logger.info(`DEV group changed to: ${jid} (${group.subject})`);
            }
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
            this.clearPendingState(from);
            return false;
        }
        // STATE 0: Supplier selection - waiting for 1 (FGB) or 2 (Littlerazy)
        if (this.pendingState.state === 'supplier_selection') {
            // Check for supplier selection
            if (text.trim() === '1') {
                this.pendingState.supplierType = 'fgb';
                this.pendingState.state = 'level_selection';
                this.saveState(from, 'pending', this.pendingState);
                await this.showLevelSelection(from);
                return true;
            }
            if (text.trim() === '2') {
                this.pendingState.supplierType = 'littlerazy';
                this.pendingState.state = 'level_selection';
                this.saveState(from, 'pending', this.pendingState);
                await this.showLevelSelection(from);
                return true;
            }
            // Check for CANCEL
            if (text.includes('cancel') || text.includes('batal') || text.includes('skip')) {
                await this.sock.sendMessage(from, { text: '❌ Dibatalkan.' });
                this.clearPendingState(from);
                return true;
            }
            // Invalid response - remind user
            await this.sock.sendMessage(from, {
                text: '⚠️ Balas dengan *1* (FGB) atau *2* (Littlerazy)'
            });
            return true;
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
                this.clearPendingState(from);
                return true;
            }
            // Invalid response - remind user
            await this.sock.sendMessage(from, {
                text: '⚠️ Balas dengan angka 1, 2, atau 3 untuk pilih level rekomendasi.'
            });
            return true;
        }
        // STATE 2: Draft pending - unified command handling
        if (this.pendingState.state === 'draft_pending') {
            const cmd = (0, draftCommands_1.parseDraftCommand)(text);
            switch (cmd.action) {
                case 'send':
                    const sendTargetJid = cmd.target === 'dev' && this.devGroupJid ? this.devGroupJid : undefined;
                    await this.sendBroadcast(from, sendTargetJid);
                    return true;
                case 'schedule':
                    const scheduleTargetJid = cmd.target === 'dev' && this.devGroupJid ? this.devGroupJid : undefined;
                    await this.scheduleBroadcast(from, cmd.interval, scheduleTargetJid);
                    return true;
                case 'regen':
                    // Regenerate with same level
                    if (this.pendingState.rawText) {
                        const currentLevel = this.pendingState.parsedData?.level || 2;
                        await this.generateDraftWithLevel(from, currentLevel);
                    }
                    return true;
                case 'cover':
                    // Search for cover images based on parsed title
                    await this.searchCoverForForward(from);
                    return true;
                case 'links':
                    await this.sock.sendMessage(from, { text: '🔍 LINKS belum tersedia untuk forward mode.' });
                    return true;
                case 'edit':
                    // Send clean draft for copy-paste
                    if (this.pendingState.draft) {
                        await this.sock.sendMessage(from, { text: this.pendingState.draft });
                    }
                    await this.sock.sendMessage(from, {
                        text: '✏️ Copy draft di atas, edit sesuai keinginan, lalu forward ulang ke saya!'
                    });
                    this.clearPendingState(from);
                    return true;
                case 'cancel':
                    await this.sock.sendMessage(from, { text: '❌ Draft dibatalkan.' });
                    this.clearPendingState(from);
                    return true;
            }
        }
        return false;
    }
    /**
     * Show level selection prompt (called after supplier is selected)
     */
    async showLevelSelection(from) {
        if (!this.pendingState)
            return;
        const levelSelectionMessage = `📚 *Supplier: ${this.pendingState.supplierType?.toUpperCase() || 'FGB'}*

Pilih level rekomendasi:

1️⃣ *Standard* - Informatif, light hard-sell
2️⃣ *Recommended* - Persuasif, medium hard-sell  
3️⃣ *Top Pick* ⭐ - Racun belanja! + marker "Top Pick Ahmari Bookstore"

---
Balas dengan angka *1*, *2*, atau *3*`;
        if (this.pendingState.mediaPaths.length > 0) {
            await this.sock.sendMessage(from, {
                image: { url: this.pendingState.mediaPaths[0] },
                caption: levelSelectionMessage,
            });
        }
        else {
            await this.sock.sendMessage(from, {
                text: levelSelectionMessage,
            });
        }
    }
    async generateDraftWithLevel(from, level) {
        if (!this.pendingState || !this.pendingState.rawText) {
            await this.sock.sendMessage(from, { text: '❌ Error: data tidak ditemukan.' });
            this.clearPendingState(from);
            return;
        }
        try {
            await this.sock.sendMessage(from, { text: `⏳ Parsing & generating level ${level} draft...` });
            // Parse NOW (after level selection to save 1 API call)
            const parsedData = await this.aiClient.parse(this.pendingState.rawText, this.pendingState.mediaPaths.length, this.pendingState.supplierType || 'fgb');
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
                    caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
                });
            }
            else {
                await this.sock.sendMessage(from, {
                    text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim ke grup PRODUCTION\n• *YES DEV* - kirim ke grup DEV\n• *EDIT* - edit manual dulu\n• *CANCEL* - batalkan`,
                });
            }
        }
        catch (error) {
            logger.error('Error generating draft:', error);
            await this.sock.sendMessage(from, { text: `❌ Error: ${error.message}` });
            this.clearPendingState(from);
        }
    }
    async sendBroadcast(from, targetJid) {
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
            this.clearPendingState(from);
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
                mediaExists: mediaPaths?.length > 0 ? fs_1.default.existsSync(mediaPaths[0]) : false,
                targetGroup: isDevGroup ? 'DEV' : 'PRODUCTION'
            }, 'Sending broadcast to group');
            // Send to target group
            if (mediaPaths && mediaPaths.length > 0 && fs_1.default.existsSync(mediaPaths[0])) {
                logger.info('Sending with image...');
                await this.sock.sendMessage(sendToJid, {
                    image: { url: mediaPaths[0] },
                    caption: draft || ''
                });
            }
            else {
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
        }
        catch (error) {
            logger.error('Failed to send broadcast:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal kirim broadcast: ${error.message}`
            });
        }
        finally {
            this.clearPendingState(from);
        }
    }
    async scheduleBroadcast(from, intervalMinutes, targetJid) {
        // For now, just save to queue - full implementation would use database
        const interval = intervalMinutes || 47;
        await this.sock.sendMessage(from, {
            text: `📅 Fitur schedule masih dalam pengembangan. Interval: ${interval} menit. Untuk sementara, silakan kirim manual dengan reply YES.`
        });
        // Don't clear pending state so user can still reply YES
    }
    /**
     * Search for cover images based on forward parsed data
     */
    async searchCoverForForward(from) {
        if (!this.pendingState || !this.pendingState.parsedData) {
            await this.sock.sendMessage(from, { text: '❌ Tidak ada data buku untuk dicari cover-nya.' });
            return;
        }
        try {
            const title = this.pendingState.parsedData.title || 'buku';
            await this.sock.sendMessage(from, { text: `🔍 Mencari cover untuk "${title}"...` });
            const images = await this.aiClient.searchImages(title, 5);
            if (images.length === 0) {
                await this.sock.sendMessage(from, { text: '❌ Cover tidak ditemukan.' });
                return;
            }
            // Show options (similar to research flow)
            let msg = `📷 *Pilih cover:*\n\n`;
            images.forEach((img, i) => {
                msg += `${i + 1}. ${img.source || 'image'}\n`;
            });
            msg += `\n0. Batalkan\n\n---\nBalas dengan angka 0-${images.length}`;
            // Store in pendingState for selection
            this.pendingState.coverOptions = images;
            this.pendingState.state = 'cover_selection';
            await this.sock.sendMessage(from, { text: msg });
        }
        catch (error) {
            logger.error('Cover search error:', error);
            await this.sock.sendMessage(from, { text: `❌ Gagal cari cover: ${error.message}` });
        }
    }
    clearPendingState(userJid) {
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
            this.clearPersistedState(userJid, 'pending'); // Persist to DB
        }
    }
    async processFGBBroadcast(message, detection) {
        const from = message.key.remoteJid;
        if (!from) {
            logger.warn('processFGBBroadcast called with no remoteJid');
            return;
        }
        // Clear any existing pending state
        this.clearPendingState(from);
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
            // Store pending state for SUPPLIER SELECTION first
            this.pendingState = {
                state: 'supplier_selection',
                rawText: detection.text, // Store raw text for later parsing
                mediaPaths: [...mediaPaths],
                timestamp: Date.now()
            };
            this.saveState(from, 'pending', this.pendingState); // Persist to DB
            // Show supplier selection prompt
            const supplierSelectionMessage = `📦 *Broadcast Terdeteksi!*

Dari supplier mana?

1️⃣ *FGB* (Flying Great Books)
2️⃣ *Littlerazy*

---
Balas dengan angka *1* atau *2*`;
            if (mediaPaths.length > 0) {
                await this.sock.sendMessage(from, {
                    image: { url: mediaPaths[0] },
                    caption: supplierSelectionMessage,
                });
            }
            else {
                await this.sock.sendMessage(from, {
                    text: supplierSelectionMessage,
                });
            }
            logger.info('Supplier selection prompt sent');
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
        this.clearPendingState(from);
        this.clearBulkState(from);
        // Initialize bulk state with default FGB supplier (can be changed later)
        this.bulkState = {
            active: true,
            level,
            supplierType: 'fgb', // Default to FGB, user can change with /supplier
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

Supplier: *FGB* (default)
💡 Kirim */supplier littlerazy* untuk ganti ke Littlerazy

Silakan forward broadcast.
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
            this.clearBulkState(from);
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
                // Parse with supplier type
                const parsedData = await this.aiClient.parse(item.rawText, item.mediaPaths.length, this.bulkState.supplierType);
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
            this.clearBulkState(from);
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
        preview += `• *YES* - Kirim semua ke PRODUCTION\n`;
        preview += `• *YES DEV* - Kirim semua ke DEV\n`;
        preview += `• *1,2,4* - Pilih item tertentu (sisanya skip)\n`;
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
        const cmd = (0, draftCommands_1.parseDraftCommand)(text);
        switch (cmd.action) {
            case 'send':
                const targetJid = cmd.target === 'dev' && this.devGroupJid ? this.devGroupJid : undefined;
                await this.sendBulkBroadcasts(from, targetJid);
                return true;
            case 'schedule':
                const scheduleTarget = cmd.target === 'dev' && this.devGroupJid ? this.devGroupJid : undefined;
                await this.scheduleBulkBroadcasts(from, cmd.interval || 30, scheduleTarget);
                return true;
            case 'select':
                // User selected specific items (e.g., "1,2,4")
                if (cmd.selectedItems && cmd.selectedItems.length > 0) {
                    await this.handleBulkItemSelection(from, cmd.selectedItems);
                }
                else {
                    // "ALL" was selected
                    await this.sendBulkBroadcasts(from);
                }
                return true;
            case 'cancel':
                await this.sock.sendMessage(from, { text: '❌ Bulk mode dibatalkan.' });
                this.clearBulkState(from);
                return true;
        }
        return false;
    }
    /**
     * Handle bulk item selection (e.g., user replied "1,2,4")
     * Selected items proceed to send, others go to edit queue
     */
    async handleBulkItemSelection(from, selectedIndices) {
        if (!this.bulkState)
            return;
        const totalItems = this.bulkState.items.filter(i => i.generated?.draft).length;
        const validIndices = selectedIndices.filter(i => i >= 1 && i <= totalItems);
        if (validIndices.length === 0) {
            await this.sock.sendMessage(from, {
                text: `⚠️ Pilihan tidak valid. Pilih angka 1-${totalItems} (contoh: 1,2,4) atau *ALL* untuk semua.`
            });
            return;
        }
        // Mark selected items
        const selectedSet = new Set(validIndices);
        const selectedItems = this.bulkState.items.filter((_, i) => selectedSet.has(i + 1));
        const rejectedItems = this.bulkState.items.filter((_, i) => !selectedSet.has(i + 1));
        // Send selected items
        await this.sock.sendMessage(from, {
            text: `✅ Mengirim ${selectedItems.length} broadcast terpilih...`
        });
        // Actually send the selected ones
        let sentCount = 0;
        for (const item of selectedItems) {
            if (item.generated?.draft) {
                try {
                    if (item.mediaPaths.length > 0 && fs_1.default.existsSync(item.mediaPaths[0])) {
                        await this.sock.sendMessage(this.targetGroupJid, {
                            image: { url: item.mediaPaths[0] },
                            caption: item.generated.draft
                        });
                    }
                    else {
                        await this.sock.sendMessage(this.targetGroupJid, {
                            text: item.generated.draft
                        });
                    }
                    sentCount++;
                    await sleep(1500);
                }
                catch (error) {
                    logger.error('Failed to send bulk item:', error);
                }
            }
        }
        await this.sock.sendMessage(from, {
            text: `✅ ${sentCount}/${selectedItems.length} broadcast terkirim!`
        });
        // Show rejected items for individual editing
        if (rejectedItems.length > 0) {
            await this.sock.sendMessage(from, {
                text: `📝 *${rejectedItems.length} item tidak terpilih.*\n\nItem ini bisa di-forward ulang untuk di-edit satu per satu.`
            });
        }
        this.clearBulkState(from);
    }
    async sendBulkBroadcasts(from, targetJid) {
        // Use provided targetJid or default to production group
        const sendToJid = targetJid || this.targetGroupJid;
        const isDevGroup = targetJid === this.devGroupJid;
        if (!this.bulkState || !sendToJid) {
            if (!sendToJid) {
                await this.sock.sendMessage(from, {
                    text: '❌ TARGET_GROUP_JID belum di-set.'
                });
            }
            this.clearBulkState(from);
            return;
        }
        this.bulkState.state = 'sending';
        const successItems = this.bulkState.items.filter(item => item.generated && !item.generated.error);
        const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
        await this.sock.sendMessage(from, {
            text: `⏳ Mengirim ${successItems.length} broadcast ke grup ${groupType}...`
        });
        let sentCount = 0;
        for (let i = 0; i < successItems.length; i++) {
            const item = successItems[i];
            try {
                // Send to group
                if (item.mediaPaths.length > 0 && fs_1.default.existsSync(item.mediaPaths[0])) {
                    await this.sock.sendMessage(sendToJid, {
                        image: { url: item.mediaPaths[0] },
                        caption: item.generated?.draft || ''
                    });
                }
                else {
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
            }
            catch (error) {
                logger.error(`Failed to send bulk item ${i + 1}:`, error);
            }
        }
        await this.sock.sendMessage(from, {
            text: `✅ ${sentCount}/${successItems.length} broadcast terkirim ke grup ${groupType}!`
        });
        this.clearBulkState(from);
    }
    async scheduleBulkBroadcasts(from, intervalMinutes, targetJid) {
        // Use provided targetJid or default to production group
        const sendToJid = targetJid || this.targetGroupJid;
        const isDevGroup = targetJid === this.devGroupJid;
        if (!this.bulkState || !sendToJid) {
            if (!sendToJid) {
                await this.sock.sendMessage(from, {
                    text: '❌ TARGET_GROUP_JID belum di-set.'
                });
            }
            this.clearBulkState(from);
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
            const capturedJid = sendToJid; // Use sendToJid, not this.targetGroupJid
            const sock = this.sock;
            const itemTitle = item.parsedData?.title || 'Untitled';
            const itemDraft = capturedItem.generated?.draft || '';
            const itemMediaPaths = capturedItem.mediaPaths || [];
            // Create timeout and store ID
            const timeoutId = setTimeout(async () => {
                try {
                    if (capturedItem.mediaPaths.length > 0 && fs_1.default.existsSync(capturedItem.mediaPaths[0])) {
                        await sock.sendMessage(capturedJid, {
                            image: { url: capturedItem.mediaPaths[0] },
                            caption: capturedItem.generated?.draft || ''
                        });
                    }
                    else {
                        await sock.sendMessage(capturedJid, {
                            text: capturedItem.generated?.draft || ''
                        });
                    }
                    logger.info(`Scheduled broadcast ${capturedIndex + 1} sent to ${isDevGroup ? 'DEV' : 'PROD'}`);
                    // Remove from queue after sending
                    this.scheduledQueue = this.scheduledQueue.filter(q => !(q.title === itemTitle && q.scheduledTime.getTime() === scheduledTime.getTime()));
                }
                catch (error) {
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
    clearBulkState(userJid) {
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
            this.clearPersistedState(userJid, 'bulk'); // Persist to DB
        }
    }
    // ==================== RESEARCH MODE METHODS (/new) ====================
    async startBookResearch(from, query) {
        if (!query.trim()) {
            await this.sock.sendMessage(from, {
                text: `❌ Penggunaan: /new <judul buku>\n\nContoh: /new Encyclopedia Britannica Kids`
            });
            return;
        }
        // Clear any existing states
        this.clearPendingState(from);
        this.clearBulkState(from);
        this.clearResearchState(from);
        try {
            await this.sock.sendMessage(from, {
                text: `🔍 Mencari: "${query}"...\n\nMohon tunggu...`
            });
            // Call AI Processor to search books
            const searchResponse = await this.aiClient.searchBooks(query, 10); // Fetch max for pagination
            if (searchResponse.count === 0) {
                await this.sock.sendMessage(from, {
                    text: `❌ Tidak ditemukan buku dengan kata kunci "${query}".\n\n💡 *Tips:* Coba lebih spesifik, misalnya:\n• Tambahkan nama publisher\n• Tulis judul lengkap\n• Gunakan bahasa asli buku`
                });
                return;
            }
            // Deduplicate by cleaned title (keep first occurrence with best data)
            const seenTitles = new Set();
            const deduped = searchResponse.results.filter(book => {
                // Normalize title for deduplication
                const normalizedTitle = book.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (seenTitles.has(normalizedTitle)) {
                    return false;
                }
                seenTitles.add(normalizedTitle);
                return true;
            }).slice(0, 10); // Keep max 10 unique results for pagination
            // Store research state with deduplicated results
            this.researchState = {
                state: 'selection_pending',
                query,
                results: deduped,
                level: 2, // Default to level 2
                currentPage: 0, // Start at first page
                timestamp: Date.now()
            };
            // Send intro message with page info
            const totalPages = Math.ceil(deduped.length / 5);
            await this.sock.sendMessage(from, {
                text: `📚 *Ditemukan ${deduped.length} buku:* (halaman 1/${totalPages})`
            });
            // Send first 5 results (page 0)
            const pageSize = 5;
            const startIdx = 0;
            const endIdx = Math.min(pageSize, deduped.length);
            for (let i = startIdx; i < endIdx; i++) {
                const book = deduped[i];
                const publisher = book.publisher ? `\nPublisher: ${book.publisher}` : '';
                const caption = `*${i + 1}. ${book.title}*${publisher}`;
                if (book.image_url) {
                    try {
                        await this.sock.sendMessage(from, {
                            image: { url: book.image_url },
                            caption
                        });
                    }
                    catch (e) {
                        // Fallback to text if image fails
                        await this.sock.sendMessage(from, { text: caption });
                    }
                }
                else {
                    await this.sock.sendMessage(from, { text: caption });
                }
                // Small delay between messages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            // Send selection prompt with NEXT option if more pages
            const hasMore = deduped.length > pageSize;
            const nextHint = hasMore ? '\n*NEXT* - lihat 5 hasil berikutnya' : '';
            await this.sock.sendMessage(from, {
                text: `---\nBalas dengan *angka* (1-${Math.min(pageSize, deduped.length)}) untuk pilih buku.${nextHint}\n/cancel - batalkan`
            });
            logger.info(`Book search results shown: ${deduped.length} books as image bubbles`);
        }
        catch (error) {
            logger.error('Book search error:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal mencari buku: ${error.message}\n\nPastikan GOOGLE_SEARCH_API_KEY sudah dikonfigurasi.`
            });
            this.clearResearchState(from);
        }
    }
    async handleResearchResponse(from, text) {
        if (!this.researchState)
            return false;
        // Check if state is expired (10 minutes for research)
        if (Date.now() - this.researchState.timestamp > 10 * 60 * 1000) {
            logger.info('Research state expired');
            this.clearResearchState(from);
            return false;
        }
        // STATE 1: Waiting for book selection (number)
        if (this.researchState.state === 'selection_pending') {
            const lowerText = text.trim().toLowerCase();
            const pageSize = 5;
            const totalResults = this.researchState.results?.length || 0;
            const totalPages = Math.ceil(totalResults / pageSize);
            const currentPage = this.researchState.currentPage || 0;
            // Handle NEXT command
            if (lowerText === 'next' || lowerText === 'n') {
                if (currentPage < totalPages - 1) {
                    this.researchState.currentPage = currentPage + 1;
                    const newPage = currentPage + 1;
                    const startIdx = newPage * pageSize;
                    const endIdx = Math.min(startIdx + pageSize, totalResults);
                    await this.sock.sendMessage(from, {
                        text: `📚 *Hasil pencarian* (halaman ${newPage + 1}/${totalPages})`
                    });
                    for (let i = startIdx; i < endIdx; i++) {
                        const book = this.researchState.results[i];
                        const publisher = book.publisher ? `\nPublisher: ${book.publisher}` : '';
                        const caption = `*${i + 1}. ${book.title}*${publisher}`;
                        if (book.image_url) {
                            try {
                                await this.sock.sendMessage(from, {
                                    image: { url: book.image_url },
                                    caption
                                });
                            }
                            catch (e) {
                                await this.sock.sendMessage(from, { text: caption });
                            }
                        }
                        else {
                            await this.sock.sendMessage(from, { text: caption });
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    const hasPrev = newPage > 0;
                    const hasNext = newPage < totalPages - 1;
                    const navHints = [
                        hasPrev ? '*PREV* - halaman sebelumnya' : '',
                        hasNext ? '*NEXT* - halaman berikutnya' : ''
                    ].filter(Boolean).join('\n');
                    await this.sock.sendMessage(from, {
                        text: `---\nBalas dengan *angka* (${startIdx + 1}-${endIdx}) untuk pilih buku.\n${navHints}\n/cancel - batalkan`
                    });
                    return true;
                }
                else {
                    await this.sock.sendMessage(from, { text: '⚠️ Sudah di halaman terakhir.' });
                    return true;
                }
            }
            // Handle PREV command
            if (lowerText === 'prev' || lowerText === 'p' || lowerText === 'back') {
                if (currentPage > 0) {
                    this.researchState.currentPage = currentPage - 1;
                    const newPage = currentPage - 1;
                    const startIdx = newPage * pageSize;
                    const endIdx = Math.min(startIdx + pageSize, totalResults);
                    await this.sock.sendMessage(from, {
                        text: `📚 *Hasil pencarian* (halaman ${newPage + 1}/${totalPages})`
                    });
                    for (let i = startIdx; i < endIdx; i++) {
                        const book = this.researchState.results[i];
                        const publisher = book.publisher ? `\nPublisher: ${book.publisher}` : '';
                        const caption = `*${i + 1}. ${book.title}*${publisher}`;
                        if (book.image_url) {
                            try {
                                await this.sock.sendMessage(from, {
                                    image: { url: book.image_url },
                                    caption
                                });
                            }
                            catch (e) {
                                await this.sock.sendMessage(from, { text: caption });
                            }
                        }
                        else {
                            await this.sock.sendMessage(from, { text: caption });
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    const hasPrev = newPage > 0;
                    const hasNext = newPage < totalPages - 1;
                    const navHints = [
                        hasPrev ? '*PREV* - halaman sebelumnya' : '',
                        hasNext ? '*NEXT* - halaman berikutnya' : ''
                    ].filter(Boolean).join('\n');
                    await this.sock.sendMessage(from, {
                        text: `---\nBalas dengan *angka* (${startIdx + 1}-${endIdx}) untuk pilih buku.\n${navHints}\n/cancel - batalkan`
                    });
                    return true;
                }
                else {
                    await this.sock.sendMessage(from, { text: '⚠️ Sudah di halaman pertama.' });
                    return true;
                }
            }
            const num = parseInt(text.trim());
            if (!isNaN(num) && num >= 1 && num <= (this.researchState.results?.length || 0)) {
                const selectedBook = this.researchState.results[num - 1];
                this.researchState.selectedBook = selectedBook;
                this.researchState.timestamp = Date.now();
                await this.sock.sendMessage(from, { text: '⏳ Mempersiapkan buku...' });
                // Step 1: Get display title (cleaner format)
                try {
                    const displayTitle = await this.aiClient.getDisplayTitle(selectedBook.title, selectedBook.source_url, selectedBook.publisher);
                    this.researchState.displayTitle = displayTitle;
                    logger.info(`Display title: ${displayTitle}`);
                }
                catch (e) {
                    logger.warn('Failed to get display title, using raw:', e);
                    this.researchState.displayTitle = selectedBook.title;
                }
                // Step 2: Enrich description from multiple sources
                try {
                    const enriched = await this.aiClient.enrichDescription(selectedBook.title, selectedBook.description || selectedBook.snippet || '', 3);
                    this.researchState.enrichedDescription = enriched.enrichedDescription;
                    logger.info(`Enriched with ${enriched.sourcesUsed} sources`);
                }
                catch (e) {
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
                    }
                    catch (e) {
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
                this.clearResearchState(from);
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
                this.clearResearchState(from);
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
                        ...this.researchState.selectedBook,
                        // Use display title if available
                        title: this.researchState.displayTitle || this.researchState.selectedBook.title,
                        // Use enriched description for better AI context
                        description: this.researchState.enrichedDescription || this.researchState.selectedBook.description
                    };
                    const generated = await this.aiClient.generateFromResearch({
                        book: enrichedBook,
                        price_main: this.researchState.details.price,
                        format: this.researchState.details.format || 'HB',
                        eta: this.researchState.details.eta,
                        close_date: this.researchState.details.closeDate,
                        min_order: this.researchState.details.minOrder,
                        level
                    });
                    this.researchState.draft = generated.draft;
                    // Send draft with image if available
                    const imagePath = this.researchState.imagePath;
                    if (imagePath && fs_1.default.existsSync(imagePath)) {
                        await this.sock.sendMessage(from, {
                            image: { url: imagePath },
                            caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
                        });
                    }
                    else {
                        await this.sock.sendMessage(from, {
                            text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - pilih cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
                        });
                    }
                    logger.info('Research draft generated');
                    return true;
                }
                catch (error) {
                    logger.error('Research generation error:', error);
                    await this.sock.sendMessage(from, {
                        text: `❌ Gagal generate draft: ${error.message}`
                    });
                    this.clearResearchState(from);
                    return true;
                }
            }
            // Check for cancel
            if (text.includes('cancel') || text.includes('batal')) {
                await this.sock.sendMessage(from, { text: '❌ Pencarian dibatalkan.' });
                this.clearResearchState(from);
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
                }
                else {
                    // Download selected image
                    const selectedImage = this.researchState.imageOptions[num - 1];
                    try {
                        await this.sock.sendMessage(from, { text: '⬇️ Downloading cover...' });
                        const imagePath = await this.aiClient.downloadResearchImage(selectedImage.url);
                        if (imagePath) {
                            this.researchState.imagePath = imagePath;
                            await this.sock.sendMessage(from, { text: '✅ Cover berhasil diganti!' });
                        }
                    }
                    catch (e) {
                        logger.warn('Failed to download selected image:', e);
                        await this.sock.sendMessage(from, { text: '❌ Gagal download cover.' });
                    }
                }
                // Return to draft_pending and re-display draft
                this.researchState.state = 'draft_pending';
                const imagePath = this.researchState.imagePath;
                if (imagePath && fs_1.default.existsSync(imagePath)) {
                    await this.sock.sendMessage(from, {
                        image: { url: imagePath },
                        caption: `📝 *DRAFT BROADCAST*\n\n${this.researchState.draft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
                    });
                }
                else {
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
        // STATE 4.5: Waiting for regeneration feedback
        if (this.researchState.state === 'regen_feedback_pending') {
            // Cancel if user sends 0
            if (text.trim() === '0') {
                this.researchState.state = 'draft_pending';
                await this.sock.sendMessage(from, { text: '↩️ Kembali ke draft menu.' });
                return true;
            }
            // Use the feedback to regenerate
            const userFeedback = text.trim();
            await this.sock.sendMessage(from, { text: `🔄 Regenerating berdasarkan feedback: _"${userFeedback}"_...` });
            try {
                const enrichedBook = {
                    ...this.researchState.selectedBook,
                    title: this.researchState.displayTitle || this.researchState.selectedBook.title,
                    description: this.researchState.enrichedDescription || this.researchState.selectedBook.description
                };
                const generated = await this.aiClient.generateFromResearch({
                    book: enrichedBook,
                    price_main: this.researchState.details.price,
                    format: this.researchState.details.format || 'HB',
                    eta: this.researchState.details.eta,
                    close_date: this.researchState.details.closeDate,
                    min_order: this.researchState.details.minOrder,
                    level: this.researchState.level || 2,
                    userEdit: userFeedback // Pass feedback to AI prompt
                });
                this.researchState.draft = generated.draft;
                this.researchState.state = 'draft_pending';
                // Re-display with new draft
                const imagePath = this.researchState.imagePath;
                const optionsText = `---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`;
                if (imagePath && fs_1.default.existsSync(imagePath)) {
                    await this.sock.sendMessage(from, {
                        image: { url: imagePath },
                        caption: `📝 *DRAFT BROADCAST (Updated per feedback)*\n\n${generated.draft}\n\n${optionsText}`
                    });
                }
                else {
                    await this.sock.sendMessage(from, {
                        text: `📝 *DRAFT BROADCAST (Updated per feedback)*\n\n${generated.draft}\n\n${optionsText}`
                    });
                }
                return true;
            }
            catch (error) {
                this.researchState.state = 'draft_pending';
                await this.sock.sendMessage(from, { text: `❌ Gagal regenerate: ${error.message}` });
                return true;
            }
        }
        // STATE 4: Draft generated, waiting for YES/EDIT/CANCEL/etc.
        if (this.researchState.state === 'draft_pending' && this.researchState.draft) {
            // Map number selection to commands: 1=YES, 2=YES DEV, 3=COVER, 4=LINKS, 5=REGEN, 6=EDIT, 7=CANCEL
            const numMap = { '1': 'yes', '2': 'yes dev', '3': 'cover', '4': 'links', '5': 'regen', '6': 'edit', '7': 'cancel' };
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
            // 5. REGEN - ask for feedback first, then regenerate
            if (mappedText === 'regen' || mappedText.includes('regen') || mappedText.includes('ulang')) {
                // Ask for feedback/evaluation of current description
                await this.sock.sendMessage(from, {
                    text: `📝 *Evaluasi deskripsi saat ini:*\n\n_"${this.researchState.draft?.substring(0, 200)}..."_\n\n---\n*Apa yang perlu diperbaiki?*\nContoh:\n• "terlalu panjang"\n• "kurang menarik"\n• "tolong tambahkan info tentang ilustrasi"\n• "ubah jadi lebih santai"\n\nBalas dengan feedback-mu, atau kirim *0* untuk batal.`
                });
                this.researchState.state = 'regen_feedback_pending';
                return true;
            }
            // 6. EDIT
            if (mappedText === 'edit' || mappedText.includes('ubah')) {
                // Send clean draft for easy copy-paste editing
                if (this.researchState.draft) {
                    await this.sock.sendMessage(from, { text: this.researchState.draft });
                }
                await this.sock.sendMessage(from, {
                    text: '✏️ Copy draft di atas, edit sesuai keinginan, lalu kirim ulang ke saya!'
                });
                this.clearResearchState(from);
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
                }
                catch (error) {
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
                    const updatedDraft = this.researchState.draft.replace(/Preview:\n[\s\S]*$/, `Preview:\n${linksSection}`);
                    this.researchState.draft = updatedDraft;
                    // Re-display updated draft
                    const imagePath = this.researchState.imagePath;
                    if (imagePath && fs_1.default.existsSync(imagePath)) {
                        await this.sock.sendMessage(from, {
                            image: { url: imagePath },
                            caption: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - ganti cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
                        });
                    }
                    else {
                        await this.sock.sendMessage(from, {
                            text: `📝 *DRAFT BROADCAST (Updated)*\n\n${updatedDraft}\n\n---\nBalas dengan:\n1. *YES* - kirim ke grup PRODUCTION\n2. *YES DEV* - kirim ke grup DEV\n3. *COVER* - pilih cover image\n4. *LINKS* - cari link preview\n5. *REGEN* - regenerate review\n6. *EDIT* - edit manual\n7. *CANCEL* - batalkan`
                        });
                    }
                    logger.info(`Updated draft with ${newLinks.length} new preview links`);
                    return true;
                }
                catch (error) {
                    logger.error('Link search error:', error);
                    await this.sock.sendMessage(from, { text: `❌ Gagal cari link: ${error.message}` });
                    return true;
                }
            }
            // 7. CANCEL
            if (mappedText === 'cancel' || mappedText.includes('batal') || mappedText.includes('skip')) {
                await this.sock.sendMessage(from, { text: '❌ Draft dibatalkan.' });
                this.clearResearchState(from);
                return true;
            }
        }
        return false;
    }
    parseResearchDetails(text) {
        const parts = text.toLowerCase().split(/\s+/);
        if (parts.length === 0)
            return null;
        // First part should be price
        const price = parseInt(parts[0].replace(/[^\d]/g, ''));
        if (isNaN(price) || price <= 0)
            return null;
        let format;
        let eta;
        let closeDate;
        let minOrder;
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
                }
                else {
                    eta = monthPart.charAt(0).toUpperCase() + monthPart.slice(1);
                }
                break;
            }
        }
        return { price, format: format || 'HB', eta, closeDate, minOrder };
    }
    async sendResearchBroadcast(from, targetJid) {
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
            this.clearResearchState(from);
            return;
        }
        try {
            const { draft, imagePath } = this.researchState;
            // Send to target group
            if (imagePath && fs_1.default.existsSync(imagePath)) {
                await this.sock.sendMessage(sendToJid, {
                    image: { url: imagePath },
                    caption: draft || ''
                });
            }
            else {
                await this.sock.sendMessage(sendToJid, {
                    text: draft || '(empty draft)'
                });
            }
            logger.info(`Research broadcast sent to group: ${sendToJid} (${isDevGroup ? 'DEV' : 'PROD'})`);
            const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
            await this.sock.sendMessage(from, {
                text: `✅ Broadcast berhasil dikirim ke grup ${groupType}!`
            });
        }
        catch (error) {
            logger.error('Failed to send research broadcast:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal kirim broadcast: ${error.message}`
            });
        }
        finally {
            this.clearResearchState(from);
        }
    }
    clearResearchState(userJid) {
        if (this.researchState) {
            // Cleanup image if exists
            if (this.researchState.imagePath) {
                try {
                    if (fs_1.default.existsSync(this.researchState.imagePath)) {
                        fs_1.default.unlinkSync(this.researchState.imagePath);
                        logger.debug(`Cleaned up research image: ${this.researchState.imagePath}`);
                    }
                }
                catch (error) {
                    logger.error(`Failed to cleanup research image:`, error);
                }
            }
            this.researchState = null;
            this.clearPersistedState(userJid, 'research'); // Persist to DB
        }
    }
    // ==================== POSTER GENERATION FLOW REMOVED (DEPRECATED) ====================
    // ==================== CAPTION GENERATION FLOW ====================
    async startCaptionMode(from) {
        // Clear any existing caption state
        this.clearCaptionState(from);
        // Initialize caption state
        this.captionState = {
            state: 'awaiting_image',
            timestamp: Date.now()
        };
        await this.sock.sendMessage(from, {
            text: `📝 *CAPTION MODE*

Kirim gambar poster atau cover buku.

🖼️ *Poster (banyak buku)* → Series promo
📕 *Cover (1 buku)* → Single book promo

Reply *CANCEL* untuk batalkan.`
        });
        logger.info('Caption mode started');
    }
    /**
     * Start caption mode with an already received image.
     * Called when user sends image-only message (no FGB caption).
     */
    async startCaptionModeWithImage(from, message) {
        // Clear any existing state
        this.clearCaptionState(from);
        // Initialize caption state - skip awaiting_image since we already have it
        this.captionState = {
            state: 'awaiting_image', // Will transition after collectCaptionImage
            timestamp: Date.now()
        };
        logger.info('Caption mode started with image (auto-detected)');
        // Immediately process the image
        await this.collectCaptionImage(from, message);
    }
    async handleCaptionResponse(from, text, message) {
        if (!this.captionState)
            return false;
        // Check if state is expired (10 minutes)
        if (Date.now() - this.captionState.timestamp > 10 * 60 * 1000) {
            logger.info('Caption state expired');
            this.clearCaptionState(from);
            return false;
        }
        const lowerText = text.toLowerCase().trim();
        // Check for CANCEL at any state
        if (lowerText === 'cancel' || lowerText === 'batal') {
            await this.sock.sendMessage(from, { text: '❌ Caption mode dibatalkan.' });
            this.clearCaptionState(from);
            return true;
        }
        // STATE: Awaiting image
        if (this.captionState.state === 'awaiting_image') {
            // Check if message has image
            const content = message.message;
            if (content?.imageMessage) {
                await this.collectCaptionImage(from, message);
                return true;
            }
            // Not an image - ignore or remind
            return false;
        }
        // STATE: Awaiting details (price, format, eta, close)
        if (this.captionState.state === 'awaiting_details') {
            const details = this.parseCaptionDetails(text);
            if (!details) {
                await this.sock.sendMessage(from, {
                    text: `⚠️ Format tidak valid. Contoh:
• 175000 bb apr26 close 20des
• 125000 hb mei26

Reply dengan: [harga] [format] [eta] [close date]`
                });
                return true;
            }
            this.captionState.details = details;
            this.captionState.state = 'level_selection';
            this.captionState.timestamp = Date.now();
            await this.sock.sendMessage(from, {
                text: `✅ Details disimpan:
💰 Rp ${details.price.toLocaleString('id-ID')}
📦 ${details.format}
${details.eta ? `📅 ETA: ${details.eta}` : ''}
${details.closeDate ? `⏰ Close: ${details.closeDate}` : ''}

Pilih level rekomendasi:
*1* - Standard (informatif)
*2* - Recommended (persuasif)
*3* - Top Pick (racun mode 🔥)`
            });
            return true;
        }
        // STATE: Level selection
        if (this.captionState.state === 'level_selection') {
            if (['1', '2', '3'].includes(lowerText)) {
                const level = parseInt(lowerText);
                await this.generateCaptionDraft(from, level);
                return true;
            }
            await this.sock.sendMessage(from, {
                text: '⚠️ Balas dengan 1, 2, atau 3'
            });
            return true;
        }
        // STATE: Draft pending - unified command handling
        if (this.captionState.state === 'draft_pending') {
            const cmd = (0, draftCommands_1.parseDraftCommand)(text);
            switch (cmd.action) {
                case 'send':
                    const targetJid = cmd.target === 'dev' && this.devGroupJid ? this.devGroupJid : undefined;
                    await this.sendCaptionBroadcast(from, targetJid);
                    return true;
                case 'schedule':
                    // TODO: Implement schedule for caption
                    await this.sock.sendMessage(from, {
                        text: `📅 Schedule (${cmd.interval || 47} menit) belum tersedia. Kirim manual dengan YES.`
                    });
                    return true;
                case 'regen':
                    this.captionState.state = 'level_selection';
                    await this.sock.sendMessage(from, {
                        text: `Pilih level lagi:\n*1* - Standard | *2* - Recommended | *3* - Top Pick`
                    });
                    return true;
                case 'cover':
                    await this.searchCoverForCaption(from);
                    return true;
                case 'links':
                    await this.sock.sendMessage(from, { text: '🔍 LINKS belum tersedia untuk caption mode.' });
                    return true;
                case 'edit':
                    if (this.captionState.draft) {
                        await this.sock.sendMessage(from, { text: this.captionState.draft });
                    }
                    await this.sock.sendMessage(from, {
                        text: '✏️ Draft di atas. Edit manual lalu kirim ulang kalau perlu.'
                    });
                    this.clearCaptionState(from);
                    return true;
                case 'cancel':
                    await this.sock.sendMessage(from, { text: '❌ Caption dibatalkan.' });
                    this.clearCaptionState(from);
                    return true;
            }
        }
        return false;
    }
    async collectCaptionImage(from, message) {
        if (!this.captionState)
            return;
        try {
            const content = message.message?.imageMessage;
            if (!content)
                return;
            await this.sock.sendMessage(from, { text: '⏳ Analyzing image...' });
            // Download image
            const { downloadMediaMessage } = await this.baileysPromise;
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            // Save to media folder
            const filename = `caption_${Date.now()}.jpg`;
            const filepath = path_1.default.join(this.mediaPath, filename);
            await fs_2.promises.writeFile(filepath, buffer);
            this.captionState.imagePath = filepath;
            logger.info(`Caption image saved: ${filepath}`);
            // Analyze with AI
            const analysis = await this.aiClient.analyzeCaption(filepath);
            if (analysis.error) {
                throw new Error(analysis.error);
            }
            this.captionState.analysis = analysis;
            this.captionState.state = 'awaiting_details';
            this.captionState.timestamp = Date.now();
            // Build analysis summary
            let summary = '';
            if (analysis.is_series) {
                summary = `📚 *SERIES DETECTED*

*${analysis.series_name || 'Book Series'}*
${analysis.publisher ? `Publisher: ${analysis.publisher}` : ''}

*${analysis.book_titles.length} judul:*
${analysis.book_titles.slice(0, 10).map(t => `• ${t}`).join('\n')}
${analysis.book_titles.length > 10 ? `\n...dan ${analysis.book_titles.length - 10} lainnya` : ''}

${analysis.description}`;
            }
            else {
                summary = `📕 *SINGLE BOOK DETECTED*

*${analysis.title || 'Book'}*
${analysis.author ? `by ${analysis.author}` : ''}
${analysis.publisher ? `Publisher: ${analysis.publisher}` : ''}

${analysis.description}`;
            }
            await this.sock.sendMessage(from, {
                text: `${summary}

---
Reply dengan format:
*[harga] [format] [eta] [close]*

Contoh:
175000 bb apr 26 close 20 des
125000 hb mei 26`
            });
        }
        catch (error) {
            logger.error('Caption image analysis failed:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal analyze gambar: ${error.message}`
            });
            this.clearCaptionState(from);
        }
    }
    parseCaptionDetails(input) {
        const parts = input.toLowerCase().trim().split(/\s+/);
        if (parts.length < 2)
            return null;
        // First part should be price
        const priceStr = parts[0].replace(/[^\d]/g, '');
        const price = parseInt(priceStr, 10);
        if (isNaN(price) || price <= 0)
            return null;
        // Look for format
        let format;
        const formatMatch = parts.find(p => ['hb', 'pb', 'bb'].includes(p));
        if (formatMatch) {
            format = formatMatch.toUpperCase();
        }
        // Look for ETA (month patterns)
        let eta;
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'mei', 'jun', 'jul', 'aug', 'sep', 'oct', 'okt', 'nov', 'dec', 'des'];
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (p !== 'close' && months.some(m => p.includes(m))) {
                // Check if next part looks like a year
                const nextPart = parts[i + 1];
                if (nextPart && /^\d{2,4}$/.test(nextPart)) {
                    eta = `${p.charAt(0).toUpperCase() + p.slice(1)}'${nextPart.slice(-2)}`;
                }
                else if (/\d{2}$/.test(p)) {
                    // Already has year like "apr26"
                    eta = p.charAt(0).toUpperCase() + p.slice(1, -2) + "'" + p.slice(-2);
                }
                else {
                    eta = p.charAt(0).toUpperCase() + p.slice(1);
                }
                break;
            }
        }
        // Look for close date
        let closeDate;
        const closeIdx = parts.findIndex(p => p === 'close');
        if (closeIdx !== -1 && closeIdx < parts.length - 1) {
            // Join remaining as close date
            closeDate = parts.slice(closeIdx + 1, closeIdx + 3).join(' ');
        }
        return { price, format: format || 'HB', eta, closeDate };
    }
    async generateCaptionDraft(from, level) {
        if (!this.captionState || !this.captionState.analysis || !this.captionState.details) {
            await this.sock.sendMessage(from, { text: '❌ Error: data tidak lengkap.' });
            this.clearCaptionState(from);
            return;
        }
        try {
            await this.sock.sendMessage(from, { text: `⏳ Generating level ${level} caption...` });
            const request = {
                analysis: this.captionState.analysis,
                price: this.captionState.details.price,
                format: this.captionState.details.format,
                eta: this.captionState.details.eta,
                close_date: this.captionState.details.closeDate,
                level: level
            };
            const result = await this.aiClient.generateCaption(request);
            this.captionState.level = level;
            let draft = result.draft;
            // Search preview links for book titles (for series with multiple books)
            const analysis = this.captionState.analysis;
            if (analysis.is_series && analysis.book_titles.length > 0) {
                await this.sock.sendMessage(from, { text: '🔍 Searching preview links...' });
                // Take max 3 book titles to search links for
                const titlesToSearch = analysis.book_titles.slice(0, 3);
                const previewLinks = [];
                for (const bookTitle of titlesToSearch) {
                    try {
                        const links = await this.aiClient.searchPreviewLinks(bookTitle, 1);
                        if (links.length > 0) {
                            previewLinks.push(`*- ${bookTitle}*\n${links[0]}`);
                        }
                    }
                    catch (err) {
                        logger.warn(`Failed to find preview link for: ${bookTitle}`);
                    }
                }
                // Append preview links to draft
                if (previewLinks.length > 0) {
                    draft += `\n\nPreview:\n${previewLinks.join('\n\n')}`;
                }
            }
            this.captionState.draft = draft;
            this.captionState.state = 'draft_pending';
            this.captionState.timestamp = Date.now();
            // Send draft with image
            if (this.captionState.imagePath && fs_1.default.existsSync(this.captionState.imagePath)) {
                await this.sock.sendMessage(from, {
                    image: { url: this.captionState.imagePath },
                    caption: `📝 *DRAFT CAPTION*

${draft}

---
Reply:
• *YES* - Kirim ke grup PRODUCTION
• *YES DEV* - Kirim ke grup DEV
• *REGEN* - Generate ulang
• *EDIT* - Copy draft untuk edit manual
• *CANCEL* - Batalkan`
                });
            }
            else {
                await this.sock.sendMessage(from, {
                    text: `📝 *DRAFT CAPTION*

${draft}

---
Reply: YES / YES DEV / REGEN / EDIT / CANCEL`
                });
            }
            logger.info(`Caption draft generated, level=${level}, previewLinks=${analysis.is_series}`);
        }
        catch (error) {
            logger.error('Caption generation failed:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal generate caption: ${error.message}`
            });
            this.clearCaptionState(from);
        }
    }
    async sendCaptionBroadcast(from, targetJid) {
        if (!this.captionState || !this.captionState.draft) {
            await this.sock.sendMessage(from, { text: '❌ Tidak ada draft yang pending.' });
            return;
        }
        const sendToJid = targetJid || this.targetGroupJid;
        const isDevGroup = targetJid === this.devGroupJid;
        if (!sendToJid) {
            await this.sock.sendMessage(from, {
                text: '❌ TARGET_GROUP_JID belum di-set.'
            });
            this.clearCaptionState(from);
            return;
        }
        try {
            const { draft, imagePath } = this.captionState;
            // Send to target group with image
            if (imagePath && fs_1.default.existsSync(imagePath)) {
                await this.sock.sendMessage(sendToJid, {
                    image: { url: imagePath },
                    caption: draft || ''
                });
            }
            else {
                await this.sock.sendMessage(sendToJid, {
                    text: draft || ''
                });
            }
            const groupType = isDevGroup ? '🛠️ DEV' : '🚀 PRODUCTION';
            logger.info(`Caption broadcast sent to ${groupType}: ${sendToJid}`);
            await this.sock.sendMessage(from, {
                text: `✅ Caption berhasil dikirim ke grup ${groupType}!`
            });
        }
        catch (error) {
            logger.error('Caption broadcast failed:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Gagal kirim: ${error.message}`
            });
        }
        finally {
            this.clearCaptionState(from);
        }
    }
    /**
     * Search for cover images in caption mode
     */
    async searchCoverForCaption(from) {
        if (!this.captionState || !this.captionState.analysis) {
            await this.sock.sendMessage(from, { text: '❌ Tidak ada data untuk dicari cover-nya.' });
            return;
        }
        try {
            const title = this.captionState.analysis.title || 'buku';
            await this.sock.sendMessage(from, { text: `🔍 Mencari cover untuk "${title}"...` });
            const images = await this.aiClient.searchImages(title, 5);
            if (images.length === 0) {
                await this.sock.sendMessage(from, { text: '❌ Cover tidak ditemukan.' });
                return;
            }
            let msg = `📷 *Pilih cover:*\n\n`;
            images.forEach((img, i) => {
                msg += `${i + 1}. ${img.source || 'image'}\n`;
            });
            msg += `\n0. Batalkan\n\n---\nBalas dengan angka 0-${images.length}`;
            await this.sock.sendMessage(from, { text: msg });
            // TODO: Handle cover selection state for caption
        }
        catch (error) {
            logger.error('Cover search error:', error);
            await this.sock.sendMessage(from, { text: `❌ Gagal cari cover: ${error.message}` });
        }
    }
    clearCaptionState(userJid) {
        if (this.captionState) {
            // Cleanup image if exists
            if (this.captionState.imagePath) {
                try {
                    if (fs_1.default.existsSync(this.captionState.imagePath)) {
                        fs_1.default.unlinkSync(this.captionState.imagePath);
                        logger.debug(`Cleaned up caption image: ${this.captionState.imagePath}`);
                    }
                }
                catch (error) {
                    logger.error('Failed to cleanup caption image:', error);
                }
            }
            this.captionState = null;
            this.clearPersistedState(userJid, 'caption'); // Persist to DB
        }
    }
}
exports.MessageHandler = MessageHandler;
