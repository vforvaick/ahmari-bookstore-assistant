import axios from 'axios';
import { AIClient, CaptionGenerateRequest } from '../../src/aiClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AIClient', () => {
    let client: AIClient;
    const baseURL = 'http://test-ai.local';

    beforeEach(() => {
        jest.clearAllMocks();
        mockedAxios.create.mockReturnValue(mockedAxios as any);
        client = new AIClient(baseURL);
    });

    describe('parse()', () => {
        test('should parse text successfully', async () => {
            const mockResponse = { data: { title: 'Parsed Title', price_main: 100000 } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const result = await client.parse('raw text', 0);
            expect(result.title).toBe('Parsed Title');
            expect(mockedAxios.post).toHaveBeenCalledWith('/parse', {
                text: 'raw text',
                media_count: 0,
                supplier: 'fgb'
            });
        });

        test('should throw error on parse failure', async () => {
            mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
            await expect(client.parse('text', 0)).rejects.toThrow('Network error');
        });
    });

    describe('generate()', () => {
        test('should generate draft successfully', async () => {
            const mockResponse = { data: { draft: 'Generated Draft', parsed_data: {} } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const result = await client.generate({ title: 'Test' } as any, 1, 'manual edit');
            expect(result.draft).toBe('Generated Draft');
            expect(mockedAxios.post).toHaveBeenCalledWith('/generate', {
                parsed_data: { title: 'Test' },
                level: 1,
                user_edit: 'manual edit'
            });
        });
    });

    describe('healthCheck()', () => {
        test('should return true if AI processor is up', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { status: 'healthy' } });
            const isUp = await client.healthCheck();
            expect(isUp).toBe(true);
        });

        test('should return false if AI processor is down', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('500'));
            const isUp = await client.healthCheck();
            expect(isUp).toBe(false);
        });
    });

    describe('Config Methods', () => {
        test('should get config', async () => {
            const mockConfig = { price_markup: 1.5, model: 'gpt-4' };
            mockedAxios.get.mockResolvedValueOnce({ data: mockConfig });
            const result = await client.getConfig();
            expect(result).toEqual(mockConfig);
        });

        test('should set markup', async () => {
            mockedAxios.post.mockResolvedValueOnce({ data: { status: 'success', price_markup: 2.0 } });
            const result = await client.setMarkup(2.0);
            expect(result.price_markup).toBe(2.0);
            expect(mockedAxios.post).toHaveBeenCalledWith('/config', { price_markup: 2.0 });
        });
    });

    describe('Book Research', () => {
        test('should search books', async () => {
            const mockResponse = { data: { results: [{ title: 'Book 1' }], count: 1 } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const result = await client.searchBooks('query');
            expect(result.count).toBe(1);
            expect(mockedAxios.post).toHaveBeenCalledWith('/research', {
                query: 'query',
                max_results: 5
            });
        });

        test('should generate from research', async () => {
            const mockResponse = { data: { draft: 'Research Draft' } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const req = { book: { title: 'B1', source_url: 'u1' }, level: 2 } as any;
            const result = await client.generateFromResearch(req);
            expect(result.draft).toBe('Research Draft');
        });

        test('should search preview links', async () => {
            const mockResponse = { data: { links: ['link1', 'link2'], count: 2 } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const result = await client.searchPreviewLinks('Title');
            expect(result).toEqual(['link1', 'link2']);
            expect(mockedAxios.post).toHaveBeenCalledWith(
                '/research/search-links',
                null,
                expect.objectContaining({ params: { book_title: 'Title', max_links: 2 } })
            );
        });

        test('should search images', async () => {
            const mockImages = [{ url: 'img1', width: 100, height: 100 }];
            mockedAxios.post.mockResolvedValueOnce({ data: { images: mockImages, count: 1 } });
            const result = await client.searchImages('Title');
            expect(result).toEqual(mockImages);
            expect(mockedAxios.post).toHaveBeenCalledWith(
                '/research/search-images',
                null,
                expect.objectContaining({ params: { book_title: 'Title', max_images: 5 } })
            );
        });

        test('should enrich description', async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: { enriched_description: 'Enriched', sources_used: 3 }
            });
            const result = await client.enrichDescription('Title', 'Current');
            expect(result.enrichedDescription).toBe('Enriched');
            expect(result.sourcesUsed).toBe(3);
        });

        test('should get display title', async () => {
            mockedAxios.post.mockResolvedValueOnce({ data: { display_title: 'Display' } });
            const result = await client.getDisplayTitle('Title', 'URL');
            expect(result).toBe('Display');
        });
    });

    describe('Caption Analysis', () => {
        test('should analyze caption image', async () => {
            const mockResponse = { data: { is_series: true, description: 'desc' } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const result = await client.analyzeCaption('temp/img.jpg');
            expect(result.is_series).toBe(true);
        });

        test('should generate caption', async () => {
            const mockResponse = { data: { draft: 'Caption Draft' } };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);

            const req: CaptionGenerateRequest = {
                analysis: { is_series: false, description: 'd', book_titles: [] },
                price: 1000, format: 'HC', level: 1
            };
            const result = await client.generateCaption(req);
            expect(result.draft).toBe('Caption Draft');
        });
    });
});
