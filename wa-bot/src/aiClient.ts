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
  userEdit?: string;  // User feedback/edit instruction for regeneration
}

// ============== Poster Generator Interfaces Removed (deprecated) ==============

// ============== Caption Generator Interfaces ==============

export interface CaptionAnalysisResult {
  is_series: boolean;
  series_name?: string;
  publisher?: string;
  book_titles: string[];
  description: string;
  title?: string;
  author?: string;
  error?: string;
}

export interface CaptionGenerateRequest {
  analysis: CaptionAnalysisResult;
  price: number;
  format: string;
  eta?: string;
  close_date?: string;
  level: number;
  preview_links?: Array<{ title: string; url: string }>;
}

export interface CaptionGenerateResponse {
  draft: string;
  analysis: CaptionAnalysisResult;
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

  async parse(text: string, mediaCount: number, supplier: 'fgb' | 'littlerazy' = 'fgb'): Promise<ParsedBroadcast> {
    try {
      logger.info(`Calling AI Processor /parse endpoint (supplier=${supplier})`);
      const response = await this.client.post<ParsedBroadcast>('/parse', {
        text,
        media_count: mediaCount,
        supplier: supplier,
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
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('gif')) ext = '.gif';

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

  async searchImages(bookTitle: string, maxImages: number = 5): Promise<Array<{
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
    source?: string;
  }>> {
    try {
      logger.info(`Searching images for: "${bookTitle}"`);
      const response = await this.client.post<{
        status: string;
        book_title: string;
        images: Array<{ url: string; width: number; height: number; thumbnail?: string; source?: string }>;
        count: number;
      }>(
        '/research/search-images',
        null,
        { params: { book_title: bookTitle, max_images: maxImages } }
      );
      logger.info(`Found ${response.data.count} images`);
      return response.data.images;
    } catch (error: any) {
      logger.error('Image search failed:', error.message);
      throw new Error(`Image search failed: ${error.message}`);
    }
  }

  async enrichDescription(bookTitle: string, currentDescription: string = '', maxSources: number = 3): Promise<{
    enrichedDescription: string;
    sourcesUsed: number;
  }> {
    try {
      logger.info(`Enriching description for: "${bookTitle}"`);
      const response = await this.client.post<{
        status: string;
        book_title: string;
        enriched_description: string;
        sources_used: number;
      }>(
        '/research/enrich',
        null,
        { params: { book_title: bookTitle, current_description: currentDescription, max_sources: maxSources } }
      );
      logger.info(`Enriched with ${response.data.sources_used} sources`);
      return {
        enrichedDescription: response.data.enriched_description,
        sourcesUsed: response.data.sources_used
      };
    } catch (error: any) {
      logger.error('Description enrichment failed:', error.message);
      throw new Error(`Description enrichment failed: ${error.message}`);
    }
  }

  async getDisplayTitle(title: string, sourceUrl: string, publisher?: string): Promise<string> {
    try {
      const response = await this.client.post<{ status: string; display_title: string }>(
        '/research/display-title',
        null,
        { params: { title, source_url: sourceUrl, publisher: publisher || '' } }
      );
      return response.data.display_title;
    } catch (error: any) {
      logger.error('Get display title failed:', error.message);
      // Fallback to raw title
      return title;
    }
  }

  // ============== Poster Generator Methods Removed (deprecated) ==============

  // ============== Caption Generator Methods ==============

  async analyzeCaption(imagePath: string): Promise<CaptionAnalysisResult> {
    try {
      logger.info(`Analyzing image for caption: ${imagePath}`);

      const FormData = require('form-data');
      const fs = require('fs');
      const formData = new FormData();

      formData.append('file', fs.createReadStream(imagePath));

      const response = await this.client.post<CaptionAnalysisResult>(
        '/caption/analyze',
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 60000, // 60 seconds for AI analysis
        }
      );

      logger.info(`Caption analysis complete: series=${response.data.is_series}, titles=${response.data.book_titles?.length || 0}`);
      return response.data;
    } catch (error: any) {
      logger.error('Caption analysis failed:', error.message);
      throw new Error(`Caption analysis failed: ${error.message}`);
    }
  }

  async generateCaption(request: CaptionGenerateRequest): Promise<CaptionGenerateResponse> {
    try {
      logger.info(`Generating caption: series=${request.analysis.is_series}, level=${request.level}`);
      const response = await this.client.post<CaptionGenerateResponse>('/caption/generate', request);
      logger.info('Caption generation successful');
      return response.data;
    } catch (error: any) {
      logger.error('Caption generation failed:', error.message);
      throw new Error(`Caption generation failed: ${error.message}`);
    }
  }
}

