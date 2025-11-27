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
            timeout: 30000,
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
    async generate(parsedData, userEdit) {
        try {
            logger.info('Calling AI Processor /generate endpoint');
            const response = await this.client.post('/generate', {
                parsed_data: parsedData,
                user_edit: userEdit || null,
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
}
exports.AIClient = AIClient;
