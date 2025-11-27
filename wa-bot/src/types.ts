import { WASocket } from '@whiskeysockets/baileys';

export interface BotConfig {
  aiProcessorUrl: string;
  databasePath: string;
  targetGroupJid: string;
  ownerJid: string;
}

export interface MessageContext {
  sock: WASocket;
  messageId: string;
  from: string;
  text: string;
  hasMedia: boolean;
  mediaCount: number;
  quotedMessage?: any;
}
