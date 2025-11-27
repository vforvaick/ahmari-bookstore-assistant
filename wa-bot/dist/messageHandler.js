"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
const baileys_1 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const detector_1 = require("./detector");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const fs_2 = require("fs");
const logger = (0, pino_1.default)({ level: 'info' });
class MessageHandler {
    constructor(sock, ownerJid, aiClient, mediaPath = './media') {
        this.sock = sock;
        this.ownerJid = ownerJid;
        this.aiClient = aiClient;
        this.mediaPath = mediaPath;
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
            const isFromOwner = (0, detector_1.isOwnerMessage)(from, this.ownerJid);
            // Only process messages from owner (istri)
            if (!isFromOwner) {
                logger.debug(`Ignoring message from non-owner: ${from}`);
                return;
            }
            logger.info(`Processing message from owner: ${from}`);
            // Detect if this is an FGB broadcast
            const detection = (0, detector_1.detectFGBBroadcast)(message);
            if (detection.isFGBBroadcast) {
                logger.info('FGB broadcast detected!');
                await this.processFGBBroadcast(message, detection);
            }
            else {
                logger.debug('Not an FGB broadcast, ignoring');
            }
        }
        catch (error) {
            logger.error('Error handling message:', error);
        }
    }
    async processFGBBroadcast(message, detection) {
        const from = message.key.remoteJid;
        if (!from) {
            logger.warn('processFGBBroadcast called with no remoteJid');
            return;
        }
        const mediaPaths = [];
        try {
            // Send processing message
            await this.sock.sendMessage(from, {
                text: '⏳ Processing FGB broadcast...\n\n1. Downloading media\n2. Parsing data\n3. Generating draft',
            });
            // Download media
            if (detection.hasMedia && detection.mediaMessages.length > 0) {
                let mediaIndex = 0;
                for (const mediaMsg of detection.mediaMessages) {
                    try {
                        const buffer = await (0, baileys_1.downloadMediaMessage)({ message: mediaMsg }, 'buffer', {});
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
            // Parse with AI Processor
            const parsedData = await this.aiClient.parse(detection.text, mediaPaths.length);
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
            }
            else {
                await this.sock.sendMessage(from, {
                    text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim sekarang\n• *EDIT DULU* - edit manual dulu\n• *SCHEDULE* - masukkan ke antrian`,
                });
            }
            // TODO: Save conversation state to database
            // TODO: Wait for user response (YES/EDIT/SCHEDULE)
        }
        catch (error) {
            logger.error('Error processing FGB broadcast:', error);
            await this.sock.sendMessage(from, {
                text: `❌ Error: ${error.message}\n\nSilakan coba lagi.`,
            });
        }
        finally {
            // Cleanup temporary media files
            for (const filepath of mediaPaths) {
                try {
                    await fs_2.promises.unlink(filepath);
                    logger.debug(`Cleaned up media: ${filepath}`);
                }
                catch (error) {
                    logger.error(`Failed to cleanup media ${filepath}:`, error);
                }
            }
        }
    }
}
exports.MessageHandler = MessageHandler;
