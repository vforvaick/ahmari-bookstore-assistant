"use strict";
/**
 * Unified Draft Command Parser
 *
 * Provides consistent command parsing across all draft flows:
 * - Forward (FGB detection)
 * - Bulk (batch processing)
 * - Research (/new command)
 * - Caption (image-based)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PO_TYPES = void 0;
exports.parseDraftCommand = parseDraftCommand;
exports.getDraftMenu = getDraftMenu;
exports.formatDraftBubble = formatDraftBubble;
exports.getNavigationHints = getNavigationHints;
// PO Types constant - used for adding PO type prefix to drafts
exports.PO_TYPES = [
    'PO REGULER',
    'PO REMAINDER',
    'RANDOM PO',
    'READY STOCK',
    'SALE',
    'FAST PO'
];
/**
 * Parse user input into a DraftCommand
 * Handles all aliases and variations
 */
function parseDraftCommand(text) {
    const normalized = text.toLowerCase().trim();
    // === SEND COMMANDS ===
    // YES DEV (must check before YES)
    if (normalized === 'yes dev' || normalized === 'y dev') {
        return { action: 'send', target: 'dev' };
    }
    // YES
    if (normalized === 'yes' || normalized === 'y' || normalized === 'ya' || normalized === 'iya') {
        return { action: 'send', target: 'production' };
    }
    // ALL (bulk mode - select all)
    if (normalized === 'all') {
        return { action: 'select', selectedItems: [] }; // Empty = all
    }
    // === SCHEDULE COMMANDS ===
    // SCHEDULE DEV X
    if (normalized.startsWith('schedule dev')) {
        const parts = normalized.split(/\s+/);
        const minutes = parts[2] ? parseInt(parts[2]) : 47;
        return {
            action: 'schedule',
            target: 'dev',
            interval: isNaN(minutes) || minutes < 1 ? 47 : minutes
        };
    }
    // SCHEDULE X
    if (normalized.startsWith('schedule') || normalized.startsWith('antri') || normalized.startsWith('nanti')) {
        const parts = normalized.split(/\s+/);
        const minutes = parts[1] ? parseInt(parts[1]) : 47;
        return {
            action: 'schedule',
            target: 'production',
            interval: isNaN(minutes) || minutes < 1 ? 47 : minutes
        };
    }
    // === OTHER COMMANDS ===
    // CANCEL
    if (normalized === 'cancel' || normalized.includes('batal') || normalized.includes('skip')) {
        return { action: 'cancel' };
    }
    // EDIT
    if (normalized === 'edit' || normalized.includes('ubah') || normalized.includes('ganti')) {
        return { action: 'edit' };
    }
    // RESTART - return to beginning of current flow
    if (normalized === 'restart' || normalized === 'ulang semua' || normalized === 'mulai lagi') {
        return { action: 'restart' };
    }
    // REGEN
    if (normalized === 'regen' || normalized.includes('ulang')) {
        return { action: 'regen' };
    }
    // COVER
    if (normalized === 'cover') {
        return { action: 'cover' };
    }
    // LINKS
    if (normalized === 'links' || normalized === 'link') {
        return { action: 'links' };
    }
    // PO - add PO type prefix
    if (normalized === 'po' || normalized === 'tipe po' || normalized === 'tipe') {
        return { action: 'po' };
    }
    // BACK - go to previous step
    // '0' is a common shortcut for back/cancel in menu systems
    if (normalized === '0' || normalized === 'back' || normalized === 'kembali' || normalized === 'balik') {
        return { action: 'back' };
    }
    // === BULK SELECTION (e.g., "1,2,4" or "1 2 4") ===
    const selectionMatch = normalized.match(/^[\d,\s]+$/);
    if (selectionMatch) {
        const items = normalized
            .split(/[,\s]+/)
            .map(s => parseInt(s.trim()))
            .filter(n => !isNaN(n) && n > 0);
        if (items.length > 0) {
            return { action: 'select', selectedItems: items };
        }
    }
    // Not recognized
    return { action: null };
}
/**
 * Generate consistent draft menu message
 * @param options - Which options to show
 */
function getDraftMenu(options) {
    const lines = [];
    lines.push('---');
    lines.push('*Pilih:*');
    lines.push('1. *YES* - kirim ke grup');
    lines.push('2. *YES DEV* - kirim ke grup DEV');
    if (options.showSchedule !== false) {
        lines.push('3. *SCHEDULE [X]* - jadwalkan (default 47 menit)');
    }
    if (options.showRegen !== false) {
        lines.push('4. *REGEN* - buat ulang');
    }
    if (options.showCover !== false) {
        lines.push('5. *COVER* - ganti cover');
    }
    if (options.showLinks !== false) {
        lines.push('6. *LINKS* - cari link preview');
    }
    lines.push('7. *EDIT* - edit manual');
    lines.push('8. *PO* - tambah tipe PO');
    // Navigation options
    if (options.showBack) {
        lines.push('0. *BACK* - kembali ke langkah sebelumnya');
    }
    lines.push('❌ *CANCEL* - batalkan');
    if (options.isBulk) {
        lines.push('');
        lines.push('_Atau pilih item: 1,2,4_');
    }
    return lines.join('\n');
}
/**
 * Format BUBBLE 1: Draft content with consistent heading
 * Use this for all draft displays to ensure uniformity
 *
 * @param draft - The draft content to display
 * @param variant - Type of draft: 'broadcast', 'caption', 'updated', 'feedback'
 * @returns Formatted string for BUBBLE 1
 */
function formatDraftBubble(draft, variant = 'broadcast') {
    const headings = {
        broadcast: '📝 *DRAFT BROADCAST*',
        caption: '📝 *DRAFT CAPTION*',
        updated: '📝 *DRAFT BROADCAST (Updated)*',
        feedback: '📝 *DRAFT BROADCAST (Updated per feedback)*',
    };
    return `${headings[variant]}\n\n${draft}`;
}
/**
 * Generate consistent navigation hints for selection prompts
 * @param options - Which hints to show
 */
function getNavigationHints(options) {
    const hints = [];
    if (options.showBack && !options.isFirstStep) {
        hints.push('*0* atau *BACK* - kembali');
    }
    if (options.showCancel !== false) {
        hints.push('*CANCEL* - batalkan');
    }
    if (hints.length === 0)
        return '';
    return '\n---\n' + hints.join(' | ');
}
