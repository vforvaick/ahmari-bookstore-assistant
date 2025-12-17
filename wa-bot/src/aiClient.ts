import axios, { AxiosInstance } from 'axios';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface ParsedBroadcast {
  type?: string;
  eta?: string;
  close_date?: string;
  title?: string;
  title_en?: string;
  publisher?: string;  // Publisher name (extracted or AI-guessed)
  format?: string;
  price_main?: number;
  price_secondary?: number;
  min_order?: string;
  description_en?: string;
  description_id?: string;
  tags: string[];
  preview_links: string[];
  separator_emoji?: string;
  media_count: number;
  raw_text: string;
}

export interface ProcessorConfig {
  price_markup: number;
  model?: string;
  api_keys_count?: number;
}

export interface GenerateResponse {
  draft: string;
  parsed_data: ParsedBroadcast;
}

export class AIClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 60000, // 60 seconds for slow Gemini API on 1C1G VPS
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async parse(text: string, mediaCount: number): Promise<ParsedBroadcast> {
    try {
      logger.info('Calling AI Processor /parse endpoint');
      const response = await this.client.post<ParsedBroadcast>('/parse', {
        text,
        media_count: mediaCount,
      });
      logger.info('Parse successful');
      return response.data;
    } catch (error: any) {
      logger.error('Parse failed:', error.message);
      throw new Error(`AI Processor parse failed: ${error.message}`);
    }
  }

  async generate(
    parsedData: ParsedBroadcast,
    level: number = 1,
    userEdit?: string
  ): Promise<GenerateResponse> {
    try {
      logger.info(`Calling AI Processor /generate endpoint (level=${level})`);
      const response = await this.client.post<GenerateResponse>('/generate', {
        parsed_data: parsedData,
        user_edit: userEdit || null,
        level: level,
      });
      logger.info('Generation successful');
      return response.data;
    } catch (error: any) {
      logger.error('Generate failed:', error.message);
      throw new Error(`AI Processor generate failed: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }

  async getConfig(): Promise<ProcessorConfig> {
    try {
      const response = await this.client.get<ProcessorConfig>('/config');
      return response.data;
    } catch (error: any) {
      logger.error('Get config failed:', error.message);
      throw new Error(`Failed to get config: ${error.message}`);
    }
  }

  async setMarkup(priceMarkup: number): Promise<ProcessorConfig> {
    try {
      logger.info(`Setting price markup to: ${priceMarkup}`);
      const response = await this.client.post<{ status: string; price_markup: number }>('/config', {
        price_markup: priceMarkup,
      });
      logger.info('Markup updated successfully');
      return { price_markup: response.data.price_markup };
    } catch (error: any) {
      logger.error('Set markup failed:', error.message);
      throw new Error(`Failed to set markup: ${error.message}`);
    }
  }
}
