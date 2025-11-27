import { proto } from '@whiskeysockets/baileys';

export interface DetectionResult {
  isFGBBroadcast: boolean;
  text: string;
  hasMedia: boolean;
  mediaCount: number;
  mediaMessages: proto.IMessage[];
}

const FGB_PATTERNS = [
  /Remainder\s*\|\s*ETA/i,
  /Request\s*\|\s*ETA/i,
  /Min\.\s*\d+\s*pcs/i,
  /NETT\s+PRICE/i,
  /(🌳{2,}|🦊{2,})/,
];

export function detectFGBBroadcast(message: proto.IWebMessageInfo): DetectionResult {
  const result: DetectionResult = {
    isFGBBroadcast: false,
    text: '',
    hasMedia: false,
    mediaCount: 0,
    mediaMessages: [],
  };

  // Extract text from message
  const messageContent = message.message;
  if (!messageContent) return result;

  // Check for text content
  const textContent =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    messageContent.videoMessage?.caption ||
    '';

  result.text = textContent;

  // Check for media (images, videos, etc.)
  if (messageContent.imageMessage || messageContent.videoMessage) {
    result.hasMedia = true;
    result.mediaCount = 1;
    result.mediaMessages.push(message.message!);
  }

  // Check if matches FGB patterns
  if (textContent) {
    const hasPattern = FGB_PATTERNS.some((pattern) => pattern.test(textContent));

    // Must have pattern match AND media to be considered FGB broadcast
    if (hasPattern && result.hasMedia) {
      result.isFGBBroadcast = true;
    }
  }

  return result;
}

export function isOwnerMessage(from: string, ownerJid: string): boolean {
  return from === ownerJid;
}
