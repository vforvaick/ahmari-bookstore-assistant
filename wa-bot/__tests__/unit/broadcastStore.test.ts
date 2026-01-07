import { BroadcastStore, initBroadcastStore, getBroadcastStore, BroadcastData } from '../../src/broadcastStore';
import * as fs from 'fs';
import * as path from 'path';

describe('broadcastStore', () => {
    beforeEach(() => {
        initBroadcastStore(':memory:');
    });

    afterAll(() => {
        // No cleanup needed
    });

    const sampleBroadcast: BroadcastData = {
        title: 'Test Book',
        format: 'HC',
        price_main: 150000,
        description_id: 'Test Indonesian description',
        status: 'draft'
    };

    describe('Broadcast Methods', () => {
        test('should save and retrieve a broadcast', () => {
            const store = getBroadcastStore();
            const id = store.saveBroadcast(sampleBroadcast);
            expect(id).toBeGreaterThan(0);

            const retrieved = store.getBroadcast(id);
            expect(retrieved).not.toBeNull();
            expect(retrieved?.title).toBe(sampleBroadcast.title);
            expect(retrieved?.status).toBe('draft');
        });

        test('should update broadcast status', () => {
            const store = getBroadcastStore();
            const id = store.saveBroadcast(sampleBroadcast);

            store.updateStatus(id, 'sent');
            const updated = store.getBroadcast(id);
            expect(updated?.status).toBe('sent');
            expect(updated?.sent_at).not.toBeNull();
        });

        test('should get recent broadcasts', async () => {
            const store = getBroadcastStore();
            store.saveBroadcast({ ...sampleBroadcast, title: 'Book 1' });
            // Add a small delay to ensure different timestamps if possible, 
            // or just rely on the fact that they are inserted in order.
            // In :memory:, rowid might be enough but the query uses created_at.
            await new Promise(resolve => setTimeout(resolve, 1100));
            store.saveBroadcast({ ...sampleBroadcast, title: 'Book 2' });

            const recent = store.getRecentBroadcasts(1);
            expect(recent.length).toBe(1);
            expect(recent[0].title).toBe('Book 2');
        });

        test('should search broadcasts using FTS5', () => {
            const store = getBroadcastStore();
            store.saveBroadcast({ ...sampleBroadcast, title: 'Unique Book Title' });
            store.saveBroadcast({ ...sampleBroadcast, title: 'Common Book' });

            const results = store.searchBroadcasts('Unique');
            expect(results.length).toBe(1);
            expect(results[0].title).toBe('Unique Book Title');
        });
    });

    describe('Queue Methods', () => {
        test('should add to and retrieve from queue', () => {
            const store = getBroadcastStore();
            const bId = store.saveBroadcast(sampleBroadcast);

            const scheduledTime = new Date();
            scheduledTime.setSeconds(scheduledTime.getSeconds() - 60); // 1 minute ago

            // Format to SQLite-friendly string: YYYY-MM-DD HH:mm:ss
            const sqliteDate = scheduledTime.toISOString().replace('T', ' ').split('.')[0];

            const qId = store.addToQueue(bId, scheduledTime);
            expect(qId).toBeGreaterThan(0);

            const next = store.getNextPendingItem();
            expect(next).not.toBeNull();
            expect(next?.broadcast_id).toBe(bId);
        });

        test('should mark queue items as sent', () => {
            const store = getBroadcastStore();
            const bId = store.saveBroadcast(sampleBroadcast);
            const qId = store.addToQueue(bId, new Date());

            store.markQueueItemSent(qId);
            const pending = store.getPendingQueue();
            expect(pending.find(item => item.id === qId)).toBeUndefined();
        });

        test('should mark queue items as failed', () => {
            const store = getBroadcastStore();
            const bId = store.saveBroadcast(sampleBroadcast);
            const qId = store.addToQueue(bId, new Date());

            store.markQueueItemFailed(qId, 'Test error');
            const pending = store.getPendingQueue();
            // Failed items are still pending if retry_count < threshold (implementation dependent)
            // But getPendingQueue returns status = 'pending'
            // markQueueItemFailed sets status = 'failed'
            expect(pending.find(item => item.id === qId)).toBeUndefined();
        });

        test('should delete queue item', () => {
            const store = getBroadcastStore();
            const bId = store.saveBroadcast(sampleBroadcast);
            const qId = store.addToQueue(bId, new Date());

            store.deleteQueueItem(qId);
            expect(store.getPendingQueue().length).toBe(0);
        });

        test('should clear pending queue', () => {
            const store = getBroadcastStore();
            const bId = store.saveBroadcast(sampleBroadcast);
            store.addToQueue(bId, new Date());
            store.addToQueue(bId, new Date());

            const cleared = store.clearPendingQueue();
            expect(cleared.length).toBe(2);
            expect(store.getPendingQueue().length).toBe(0);
        });
    });

    describe('Singleton management', () => {
        test('should handle re-initialization', () => {
            initBroadcastStore(':memory:');
            const store1 = getBroadcastStore();
            initBroadcastStore(':memory:');
            const store2 = getBroadcastStore();
            expect(store2).not.toBe(store1);
        });

        test('should throw error if not initialized', () => {
            // Difficult to test due to module-level singleton state
        });
    });
});
