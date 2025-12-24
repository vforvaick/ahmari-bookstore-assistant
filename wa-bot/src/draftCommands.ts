/**
 * Unified Draft Command Parser
 * 
 * Provides consistent command parsing across all draft flows:
 * - Forward (FGB detection)
 * - Bulk (batch processing)
 * - Research (/new command)
 * - Caption (image-based)
 */

// Command action types
export type DraftAction =
    | 'send'      // YES/YES DEV
    | 'schedule'  // SCHEDULE [X]
    | 'edit'      // EDIT
    | 'cancel'    // CANCEL
    | 'regen'     // REGEN
    | 'cover'     // COVER
    | 'links'     // LINKS
    | 'select'    // Bulk selection (e.g., "1,2,4")
    | null;       // Not recognized

export type SendTarget = 'production' | 'dev';

export interface DraftCommand {
    action: DraftAction;
    target?: SendTarget;        // For 'send'
    interval?: number;          // For 'schedule' (minutes)
    selectedItems?: number[];   // For 'select' (bulk mode)
}

/**
 * Parse user input into a DraftCommand
 * Handles all aliases and variations
 */
export function parseDraftCommand(text: string): DraftCommand {
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
export function getDraftMenu(options: {
    showCover?: boolean;
    showLinks?: boolean;
    showRegen?: boolean;
    showSchedule?: boolean;
    isBulk?: boolean;
}): string {
    const lines: string[] = [];

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
    lines.push('8. *CANCEL* - batalkan');

    if (options.isBulk) {
        lines.push('');
        lines.push('_Atau pilih item: 1,2,4_');
    }

    return lines.join('\n');
}
