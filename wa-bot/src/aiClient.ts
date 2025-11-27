import axios, { AxiosInstance } from 'axios';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface ParsedBroadcast {
  type?: string;
  eta?: string;
  close_date?: string;
  title?: string;
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

export interface GenerateResponse {
  draft: string;
  parsed_data: ParsedBroadcast;
}

export class AIClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
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
    userEdit?: string
  ): Promise<GenerateResponse> {
    try {
      logger.info('Calling AI Processor /generate endpoint');
      const response = await this.client.post<GenerateResponse>('/generate', {
        parsed_data: parsedData,
        user_edit: userEdit || null,
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
}
