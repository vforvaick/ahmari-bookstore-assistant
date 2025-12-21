"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIClient = void 0;
const axios_1 = __importDefault(require("axios"));
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
class AIClient {
    constructor(baseURL) {
        this.client = axios_1.default.create({
            baseURL,
            timeout: 60000, // 60 seconds for slow Gemini API on 1C1G VPS
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async parse(text, mediaCount) {
        try {
            logger.info('Calling AI Processor /parse endpoint');
            const response = await this.client.post('/parse', {
                text,
                media_count: mediaCount,
            });
            logger.info('Parse successful');
            return response.data;
        }
        catch (error) {
            logger.error('Parse failed:', error.message);
            throw new Error(`AI Processor parse failed: ${error.message}`);
        }
    }
    async generate(parsedData, level = 1, userEdit) {
        try {
            logger.info(`Calling AI Processor /generate endpoint (level=${level})`);
            const response = await this.client.post('/generate', {
                parsed_data: parsedData,
                user_edit: userEdit || null,
                level: level,
            });
            logger.info('Generation successful');
            return response.data;
        }
        catch (error) {
            logger.error('Generate failed:', error.message);
            throw new Error(`AI Processor generate failed: ${error.message}`);
        }
    }
    async healthCheck() {
        try {
            const response = await this.client.get('/health');
            return response.data.status === 'healthy';
        }
        catch {
            return false;
        }
    }
    async getConfig() {
        try {
            const response = await this.client.get('/config');
            return response.data;
        }
        catch (error) {
            logger.error('Get config failed:', error.message);
            throw new Error(`Failed to get config: ${error.message}`);
        }
    }
    async setMarkup(priceMarkup) {
        try {
            logger.info(`Setting price markup to: ${priceMarkup}`);
            const response = await this.client.post('/config', {
                price_markup: priceMarkup,
            });
            logger.info('Markup updated successfully');
            return { price_markup: response.data.price_markup };
        }
        catch (error) {
            logger.error('Set markup failed:', error.message);
            throw new Error(`Failed to set markup: ${error.message}`);
        }
    }
    // ============== Book Research Methods ==============
    async searchBooks(query, maxResults = 5) {
        try {
            logger.info(`Searching for books: "${query}"`);
            const response = await this.client.post('/research', {
                query,
                max_results: maxResults,
            });
            logger.info(`Found ${response.data.count} books`);
            return response.data;
        }
        catch (error) {
            logger.error('Book search failed:', error.message);
            throw new Error(`Book search failed: ${error.message}`);
        }
    }
    async generateFromResearch(request) {
        try {
            logger.info(`Generating promo from research: "${request.book.title}" (level=${request.level})`);
            const response = await this.client.post('/research/generate', request);
            logger.info('Research generation successful');
            return response.data;
        }
        catch (error) {
            logger.error('Research generation failed:', error.message);
            throw new Error(`Research generation failed: ${error.message}`);
        }
    }
    async downloadResearchImage(imageUrl) {
        try {
            logger.info(`Downloading research image directly: ${imageUrl}`);
            // Download image directly in WA Bot container (not via AI Processor)
            const axios = require('axios');
            const fs = require('fs');
            const path = require('path');
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; BookBot/1.0)'
                }
            });
            // Determine file extension from content-type or URL
            const contentType = response.headers['content-type'] || '';
            let ext = '.jpg';
            if (contentType.includes('png'))
                ext = '.png';
            else if (contentType.includes('webp'))
                ext = '.webp';
            else if (contentType.includes('gif'))
                ext = '.gif';
            // Save to media directory (shared volume or local)
            const mediaDir = path.join(process.cwd(), 'media');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            const filename = `cover_${Date.now()}${ext}`;
            const filepath = path.join(mediaDir, filename);
            fs.writeFileSync(filepath, response.data);
            logger.info(`Image saved locally: ${filepath}`);
            return filepath;
        }
        catch (error) {
            logger.error('Image download failed:', error.message);
            return null;
        }
    }
    async searchPreviewLinks(bookTitle, maxLinks = 2) {
        try {
            logger.info(`Searching preview links for: "${bookTitle}"`);
            const response = await this.client.post('/research/search-links', null, { params: { book_title: bookTitle, max_links: maxLinks } });
            logger.info(`Found ${response.data.count} valid preview links`);
            return response.data.links;
        }
        catch (error) {
            logger.error('Preview link search failed:', error.message);
            throw new Error(`Preview link search failed: ${error.message}`);
        }
    }
    async searchImages(bookTitle, maxImages = 5) {
        try {
            logger.info(`Searching images for: "${bookTitle}"`);
            const response = await this.client.post('/research/search-images', null, { params: { book_title: bookTitle, max_images: maxImages } });
            logger.info(`Found ${response.data.count} images`);
            return response.data.images;
        }
        catch (error) {
            logger.error('Image search failed:', error.message);
            throw new Error(`Image search failed: ${error.message}`);
        }
    }
    async enrichDescription(bookTitle, currentDescription = '', maxSources = 3) {
        try {
            logger.info(`Enriching description for: "${bookTitle}"`);
            const response = await this.client.post('/research/enrich', null, { params: { book_title: bookTitle, current_description: currentDescription, max_sources: maxSources } });
            logger.info(`Enriched with ${response.data.sources_used} sources`);
            return {
                enrichedDescription: response.data.enriched_description,
                sourcesUsed: response.data.sources_used
            };
        }
        catch (error) {
            logger.error('Description enrichment failed:', error.message);
            throw new Error(`Description enrichment failed: ${error.message}`);
        }
    }
    async getDisplayTitle(title, sourceUrl, publisher) {
        try {
            const response = await this.client.post('/research/display-title', null, { params: { title, source_url: sourceUrl, publisher: publisher || '' } });
            return response.data.display_title;
        }
        catch (error) {
            logger.error('Get display title failed:', error.message);
            // Fallback to raw title
            return title;
        }
    }
}
exports.AIClient = AIClient;
