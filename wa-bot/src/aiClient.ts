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

// ============== Book Research Interfaces ==============

export interface BookSearchResult {
  title: string;
  author?: string;
  publisher?: string;
  description?: string;
  image_url?: string;
  source_url: string;
  snippet?: string;
}

export interface BookSearchResponse {
  query: string;
  results: BookSearchResult[];
  count: number;
}

export interface ResearchGenerateRequest {
  book: BookSearchResult;
  price_main: number;
  format: string;
  eta?: string;
  close_date?: string;
  min_order?: string;
  level: number;
  custom_image_path?: string;
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

  // ============== Book Research Methods ==============

  async searchBooks(query: string, maxResults: number = 5): Promise<BookSearchResponse> {
    try {
      logger.info(`Searching for books: "${query}"`);
      const response = await this.client.post<BookSearchResponse>('/research', {
        query,
        max_results: maxResults,
      });
      logger.info(`Found ${response.data.count} books`);
      return response.data;
    } catch (error: any) {
      logger.error('Book search failed:', error.message);
      throw new Error(`Book search failed: ${error.message}`);
    }
  }

  async generateFromResearch(request: ResearchGenerateRequest): Promise<GenerateResponse> {
    try {
      logger.info(`Generating promo from research: "${request.book.title}" (level=${request.level})`);
      const response = await this.client.post<GenerateResponse>('/research/generate', request);
      logger.info('Research generation successful');
      return response.data;
    } catch (error: any) {
      logger.error('Research generation failed:', error.message);
      throw new Error(`Research generation failed: ${error.message}`);
    }
  }

  async downloadResearchImage(imageUrl: string): Promise<string | null> {
    try {
      logger.info(`Downloading research image...`);
      const response = await this.client.post<{ status: string; filepath: string }>(
        '/research/download-image',
        null,
        { params: { image_url: imageUrl } }
      );
      logger.info(`Image saved: ${response.data.filepath}`);
      return response.data.filepath;
    } catch (error: any) {
      logger.error('Image download failed:', error.message);
      return null;
    }
  }

  async searchPreviewLinks(bookTitle: string, maxLinks: number = 2): Promise<string[]> {
    try {
      logger.info(`Searching preview links for: "${bookTitle}"`);
      const response = await this.client.post<{ status: string; links: string[]; count: number }>(
        '/research/search-links',
        null,
        { params: { book_title: bookTitle, max_links: maxLinks } }
      );
      logger.info(`Found ${response.data.count} valid preview links`);
      return response.data.links;
    } catch (error: any) {
      logger.error('Preview link search failed:', error.message);
      throw new Error(`Preview link search failed: ${error.message}`);
    }
  }
}
