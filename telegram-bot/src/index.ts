import { Telegraf } from 'telegraf';
import express from 'express';
import { config } from 'dotenv';
import pino from 'pino';

config();

const logger = pino({ level: 'info' });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TARGET_CHAT_ID = process.env.TELEGRAM_TARGET_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN is not set!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// Basic Bot Commands
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    ctx.reply(`Hello! I am ready to broadcast.\nYour Chat ID is: \`${chatId}\``, { parse_mode: 'Markdown' });
    logger.info(`New start command from ${chatId}`);
});

// API for Broadcasts
app.post('/broadcast', async (req, res) => {
    try {
        const { text, media } = req.body;
        const target = TARGET_CHAT_ID;

        if (!target) {
            logger.error('TELEGRAM_TARGET_CHAT_ID is not configured');
            return res.status(500).json({ error: 'Target chat ID not configured' });
        }

        if (!text && !media) {
            return res.status(400).json({ error: 'No content provided' });
        }

        logger.info(`Sending broadcast to ${target}`);

        if (media && media.length > 0) {
            // Handle media group (simplified: send first image with caption, or album)
            // For simplicity in this v1, if there is media, send the first one as photo with caption.
            // If multiple, ideally we use sendMediaGroup.

            if (media.length === 1) {
                // Assuming media is a URL or path accessible? 
                // Since we are running in docker, sharing local paths might be tricky unless volume mounted.
                // The Scheduler sends "media paths". 
                // If the paths are local file paths from 'wa-bot', 'telegram-bot' container cannot see them unless they share the volume.
                // They DO share 'media' volume in docker-compose.

                // Media path from scheduler is likely absolute inside container, e.g., /app/media/...
                // We need to ensure telegram-bot mounts media at the same location.

                await bot.telegram.sendPhoto(target, { source: media[0] }, { caption: text });
            } else {
                // multiple media
                const mediaGroup = media.map((m: string, i: number) => ({
                    type: 'photo',
                    media: { source: m },
                    caption: i === 0 ? text : undefined
                }));
                // Telegraf types for media group are a bit strict, casting to any for quick iteration or correct it.
                await bot.telegram.sendMediaGroup(target, mediaGroup as any);
            }
        } else {
            await bot.telegram.sendMessage(target, text);
        }

        res.json({ success: true });
    } catch (error: any) {
        logger.error('Failed to send broadcast:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => res.send('OK'));

// Start Bot
bot.launch(() => {
    logger.info('Telegram bot launched');
});

// Start Express
app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
});

// Graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
});
