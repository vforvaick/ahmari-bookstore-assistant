import { parseDraftCommand } from '../../src/draftCommands';

describe('draftCommands - parseDraftCommand', () => {
    describe('SEND commands', () => {
        test('should parse "yes dev" and "y dev"', () => {
            expect(parseDraftCommand('yes dev')).toEqual({ action: 'send', target: 'dev' });
            expect(parseDraftCommand('y dev')).toEqual({ action: 'send', target: 'dev' });
        });

        test('should parse "yes", "y", "ya", "iya"', () => {
            expect(parseDraftCommand('yes')).toEqual({ action: 'send', target: 'production' });
            expect(parseDraftCommand('y')).toEqual({ action: 'send', target: 'production' });
            expect(parseDraftCommand('ya')).toEqual({ action: 'send', target: 'production' });
            expect(parseDraftCommand('iya')).toEqual({ action: 'send', target: 'production' });
        });
    });

    describe('SCHEDULE commands', () => {
        test('should parse "schedule dev" with and without interval', () => {
            expect(parseDraftCommand('schedule dev')).toEqual({
                action: 'schedule',
                target: 'dev',
                interval: 47
            });
            expect(parseDraftCommand('schedule dev 30')).toEqual({
                action: 'schedule',
                target: 'dev',
                interval: 30
            });
            expect(parseDraftCommand('schedule dev abc')).toEqual({
                action: 'schedule',
                target: 'dev',
                interval: 47
            });
        });

        test('should parse production schedule aliases: schedule, antri, nanti', () => {
            expect(parseDraftCommand('schedule 60')).toEqual({
                action: 'schedule',
                target: 'production',
                interval: 60
            });
            expect(parseDraftCommand('antri 15')).toEqual({
                action: 'schedule',
                target: 'production',
                interval: 15
            });
            expect(parseDraftCommand('nanti')).toEqual({
                action: 'schedule',
                target: 'production',
                interval: 47
            });
        });

        test('should handle invalid intervals in schedule', () => {
            expect(parseDraftCommand('schedule 0')).toEqual({
                action: 'schedule',
                target: 'production',
                interval: 47
            });
            expect(parseDraftCommand('schedule -10')).toEqual({
                action: 'schedule',
                target: 'production',
                interval: 47
            });
        });
    });

    describe('Other commands', () => {
        test('should parse CANCEL aliases', () => {
            expect(parseDraftCommand('cancel')).toEqual({ action: 'cancel' });
            expect(parseDraftCommand('batal')).toEqual({ action: 'cancel' });
            expect(parseDraftCommand('skip')).toEqual({ action: 'cancel' });
        });

        test('should parse EDIT aliases', () => {
            expect(parseDraftCommand('edit')).toEqual({ action: 'edit' });
            expect(parseDraftCommand('ubah')).toEqual({ action: 'edit' });
            expect(parseDraftCommand('ganti')).toEqual({ action: 'edit' });
        });

        test('should parse REGEN aliases', () => {
            expect(parseDraftCommand('regen')).toEqual({ action: 'regen' });
            expect(parseDraftCommand('ulang')).toEqual({ action: 'regen' });
        });

        test('should parse COVER', () => {
            expect(parseDraftCommand('cover')).toEqual({ action: 'cover' });
        });

        test('should parse LINKS/LINK', () => {
            expect(parseDraftCommand('links')).toEqual({ action: 'links' });
            expect(parseDraftCommand('link')).toEqual({ action: 'links' });
        });

        test('should parse BACK aliases', () => {
            expect(parseDraftCommand('0')).toEqual({ action: 'back' });
            expect(parseDraftCommand('back')).toEqual({ action: 'back' });
            expect(parseDraftCommand('kembali')).toEqual({ action: 'back' });
            expect(parseDraftCommand('balik')).toEqual({ action: 'back' });
        });

        test('should parse RESTART aliases', () => {
            expect(parseDraftCommand('restart')).toEqual({ action: 'restart' });
            expect(parseDraftCommand('ulang semua')).toEqual({ action: 'restart' });
            expect(parseDraftCommand('mulai lagi')).toEqual({ action: 'restart' });
        });

        test('should parse ALL for bulk selection', () => {
            expect(parseDraftCommand('all')).toEqual({ action: 'select', selectedItems: [] });
        });
    });

    describe('Bulk selection formats', () => {
        test('should parse comma-separated numbers', () => {
            expect(parseDraftCommand('1,2,4')).toEqual({ action: 'select', selectedItems: [1, 2, 4] });
        });

        test('should parse space-separated numbers', () => {
            expect(parseDraftCommand('1 2 4')).toEqual({ action: 'select', selectedItems: [1, 2, 4] });
        });

        test('should ignore non-numeric patterns in selection-like text', () => {
            expect(parseDraftCommand('1 2 abc')).toEqual({ action: null });
        });
    });

    test('should return null for unrecognized command', () => {
        expect(parseDraftCommand('random text')).toEqual({ action: null });
        expect(parseDraftCommand('')).toEqual({ action: null });
    });
});
