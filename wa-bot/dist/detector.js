"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFGBBroadcast = detectFGBBroadcast;
exports.isOwnerMessage = isOwnerMessage;
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
const FGB_PATTERNS = [
    /Remainder\s*\|\s*ETA/i,
    /Request\s*\|\s*ETA/i,
    /Min\.\s*\d+\s*pcs/i,
    /NETT\s+PRICE/i,
    /(🌳{2,}|🦊{2,})/,
    /🏷️\s*Rp/i, // Price tag emoji with Rp
];
// Littlerazy patterns: Title HC/HB/PB/BB PRICE ETA MONTH EMOJI
const LITTLERAZY_PATTERNS = [
    /\b(HC|HB|PB|BB)\s+\d+[\.\d]*\s+ETA\s+\w+\s*[🌸🌺🌷🌹💐🌻🌼]+/i, // Format + Price + ETA + flower emoji
];
function detectFGBBroadcast(message) {
    const result = {
        isBroadcast: false,
        text: '',
        hasMedia: false,
        mediaCount: 0,
        mediaMessages: [],
    };
    // Extract text from message
    const messageContent = message.message;
    if (!messageContent) {
        logger.debug('No message content found');
        return result;
    }
    // Log message structure for debugging
    const messageTypes = Object.keys(messageContent);
    logger.debug({ messageTypes }, 'Message content types');
    // Check for text content from various message types
    let textContent = messageContent.conversation ||
        messageContent.extendedTextMessage?.text ||
        messageContent.imageMessage?.caption ||
        messageContent.videoMessage?.caption ||
        '';
    // Handle forwarded messages - check contextInfo for forwarded content
    if (messageContent.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = messageContent.extendedTextMessage.contextInfo.quotedMessage;
        const quotedText = quoted.conversation ||
            quoted.extendedTextMessage?.text ||
            quoted.imageMessage?.caption ||
            quoted.videoMessage?.caption || '';
        if (quotedText && !textContent) {
            textContent = quotedText;
        }
        // Check if quoted message has media
        if (quoted.imageMessage || quoted.videoMessage) {
            result.hasMedia = true;
            result.mediaCount++;
            result.mediaMessages.push(quoted);
        }
    }
    // Check for forwarded image/video with caption
    if (messageContent.imageMessage) {
        result.hasMedia = true;
        result.mediaCount++;
        result.mediaMessages.push(messageContent);
        if (messageContent.imageMessage.caption) {
            textContent = messageContent.imageMessage.caption;
        }
    }
    if (messageContent.videoMessage) {
        result.hasMedia = true;
        result.mediaCount++;
        result.mediaMessages.push(messageContent);
        if (messageContent.videoMessage.caption) {
            textContent = messageContent.videoMessage.caption;
        }
    }
    // Handle viewOnceMessageV2 (disappearing media)
    if (messageContent.viewOnceMessageV2?.message) {
        const viewOnce = messageContent.viewOnceMessageV2.message;
        if (viewOnce.imageMessage) {
            result.hasMedia = true;
            result.mediaCount++;
            result.mediaMessages.push(viewOnce);
            if (viewOnce.imageMessage.caption) {
                textContent = viewOnce.imageMessage.caption;
            }
        }
    }
    result.text = textContent;
    // Log detection info
    logger.debug({
        textLength: textContent.length,
        textPreview: textContent.substring(0, 100),
        hasMedia: result.hasMedia,
        mediaCount: result.mediaCount,
    }, 'Detection analysis');
    // Check if matches FGB patterns
    if (textContent) {
        const matchedFGBPatterns = FGB_PATTERNS.filter(pattern => pattern.test(textContent));
        const matchedLitterazyPatterns = LITTLERAZY_PATTERNS.filter(pattern => pattern.test(textContent));
        logger.debug({
            fgbMatches: matchedFGBPatterns.length,
            litterazyMatches: matchedLitterazyPatterns.length,
        }, 'Pattern matching result');
        // FGB patterns take priority if both match
        if (matchedFGBPatterns.length > 0) {
            result.isBroadcast = true;
            result.detectedSupplier = 'fgb';
            logger.info({
                title: textContent.match(/\*([^*]+)\*/)?.[1] || 'Unknown',
                hasMedia: result.hasMedia,
                supplier: 'fgb',
            }, 'FGB broadcast detected');
        }
        else if (matchedLitterazyPatterns.length > 0) {
            result.isBroadcast = true;
            result.detectedSupplier = 'littlerazy';
            logger.info({
                hasMedia: result.hasMedia,
                supplier: 'littlerazy',
            }, 'Littlerazy broadcast detected');
        }
    }
    return result;
}
function isOwnerMessage(from, ownerJid) {
    // Also check direct equality for safety
    if (from === ownerJid)
        return true;
    return false;
}
