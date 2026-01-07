import { detectFGBBroadcast, isOwnerMessage } from '../../src/detector';
import { proto } from '@whiskeysockets/baileys';

describe('detector - isOwnerMessage', () => {
    test('should return true if from equals ownerJid', () => {
        expect(isOwnerMessage('user1@s.whatsapp.net', 'user1@s.whatsapp.net')).toBe(true);
    });

    test('should return false if from does not equal ownerJid', () => {
        expect(isOwnerMessage('user2@s.whatsapp.net', 'owner@s.whatsapp.net')).toBe(false);
    });
});

describe('detector - detectFGBBroadcast', () => {
    test('should handle message without content', () => {
        const msg: proto.IWebMessageInfo = { key: {}, messageTimestamp: 123 };
        const result = detectFGBBroadcast(msg);
        expect(result.isBroadcast).toBe(false);
        expect(result.text).toBe('');
    });

    test('should handle conversation (simple text)', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: { conversation: 'Testing simple text' }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.isBroadcast).toBe(false);
        expect(result.text).toBe('Testing simple text');
    });

    test('should handle quoted messages with text and media', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                extendedTextMessage: {
                    text: '',
                    contextInfo: {
                        quotedMessage: {
                            conversation: 'Quoted text content',
                            imageMessage: { caption: 'Quoted image caption' }
                        }
                    }
                }
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.text).toBe('Quoted text content');
        expect(result.hasMedia).toBe(true);
        expect(result.mediaCount).toBe(1);
    });

    test('should handle image message with caption', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                imageMessage: { caption: 'Image Caption *Title*' }
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.hasMedia).toBe(true);
        expect(result.mediaCount).toBe(1);
        expect(result.text).toBe('Image Caption *Title*');
    });

    test('should handle video message with caption', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                videoMessage: { caption: 'Video Caption' }
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.hasMedia).toBe(true);
        expect(result.mediaCount).toBe(1);
        expect(result.text).toBe('Video Caption');
    });

    test('should handle viewOnceMessageV2', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                viewOnceMessageV2: {
                    message: {
                        imageMessage: { caption: 'Secret Image' }
                    }
                }
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.hasMedia).toBe(true);
        expect(result.mediaCount).toBe(1);
        expect(result.text).toBe('Secret Image');
    });

    test('should detect FGB patterns and set supplier', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                conversation: 'Remainder | ETA March 🌳🌳\n*Book Title*'
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.isBroadcast).toBe(true);
        expect(result.detectedSupplier).toBe('fgb');
    });

    test('should detect Littlerazy patterns and set supplier', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                conversation: 'Fantastic Beasts HC 125.000 ETA APRIL 🌸🌸🌸'
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.isBroadcast).toBe(true);
        expect(result.detectedSupplier).toBe('littlerazy');
    });

    test('should not detect as broadcast if no patterns match', () => {
        const msg: proto.IWebMessageInfo = {
            key: {},
            message: {
                conversation: 'Hi, what is the price of this book?'
            }
        };
        const result = detectFGBBroadcast(msg);
        expect(result.isBroadcast).toBe(false);
        expect(result.detectedSupplier).toBeUndefined();
    });
});
