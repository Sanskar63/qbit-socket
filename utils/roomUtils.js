/**
 * Room utility functions
 */

import { ROOM_CONFIG } from '../config/constants.js';

/**
 * Generate a unique room code
 */
export function generateRoomCode(existingRooms) {
    let code;
    let attempts = 0;
    const maxAttempts = 100;

    do {
        code = '';
        for (let i = 0; i < ROOM_CONFIG.ROOM_CODE_LENGTH; i++) {
            code += ROOM_CONFIG.ROOM_CODE_CHARS.charAt(
                Math.floor(Math.random() * ROOM_CONFIG.ROOM_CODE_CHARS.length)
            );
        }
        attempts++;
    } while ((existingRooms instanceof Map ? existingRooms.has(code) : existingRooms.includes(code)) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique room code');
    }

    return code;
}

/**
 * Generate default player name
 */
export function generateDefaultPlayerName(socketId) {
    return `Player_${socketId.substring(0, 6)}`;
}
