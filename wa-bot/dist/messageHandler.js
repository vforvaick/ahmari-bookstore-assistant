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
const logger = (0, pino_1.default)({ level: 'info' });
class MessageHandler {
    constructor(sock, ownerJid, mediaPath = './media') {
        this.sock = sock;
        this.ownerJid = ownerJid;
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
        // Download media
        const mediaPaths = [];
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
                    // Save media file with unique filename
                    const timestamp = Date.now();
                    const filename = `fgb_${timestamp}_${mediaIndex}.${extension}`;
                    const filepath = path_1.default.join(this.mediaPath, filename);
                    fs_1.default.writeFileSync(filepath, buffer);
                    mediaPaths.push(filepath);
                    logger.info(`Media saved: ${filepath}`);
                    mediaIndex++;
                }
                catch (error) {
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
exports.MessageHandler = MessageHandler;
