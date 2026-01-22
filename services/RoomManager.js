/**
 * Room Management Service (Reused from OPS backend)
 * Handles all room-related business logic
 */

import { ROOM_CONFIG, ROOM_STATUS } from '../config/constants.js';
import { generateRoomCode, generateDefaultPlayerName } from '../utils/roomUtils.js';

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomCode -> room object
    }

    createRoom(socketId, playerData = {}) {
        const roomCode = generateRoomCode(this.rooms);
        const room = {
            code: roomCode,
            hostId: socketId,
            players: [{
                id: socketId,
                name: playerData?.name || generateDefaultPlayerName(socketId),
                isHost: true,
                coins: 0
            }],
            status: ROOM_STATUS.WAITING,
            createdAt: Date.now(),
            maxPlayers: playerData?.maxPlayers || ROOM_CONFIG.DEFAULT_MAX_PLAYERS
        };

        this.rooms.set(roomCode, room);
        return room;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode) || null;
    }

    getAllRooms() {
        return Array.from(this.rooms.values());
    }

    getRoomCodeForSocket(socketId) {
        for (const [code, room] of this.rooms.entries()) {
            if (room.hostId === socketId || room.players.some(p => p.id === socketId)) {
                return code;
            }
        }
        return null;
    }

    validateJoinRoom(roomCode, socketId) {
        if (!this.rooms.has(roomCode)) {
            return { valid: false, error: 'Room not found' };
        }

        const room = this.rooms.get(roomCode);

        if (room.players.length >= room.maxPlayers) {
            return { valid: false, error: 'Room is full' };
        }

        if (room.status === ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game already in progress' };
        }

        if (room.players.some(p => p.id === socketId)) {
            return { valid: false, error: 'Already in this room' };
        }

        return { valid: true, error: null };
    }

    addPlayerToRoom(roomCode, socketId, playerName) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = {
            id: socketId,
            name: playerName || generateDefaultPlayerName(socketId),
            isHost: false,
            coins: 0
        };

        room.players.push(player);
        return player;
    }

    removePlayerFromRoom(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex === -1) return null;

        const wasHost = room.players[playerIndex].isHost;
        room.players.splice(playerIndex, 1);

        let roomDeleted = false;
        let newHostId = null;

        if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            room.hostId = room.players[0].id;
            newHostId = room.players[0].id;
        }

        if (room.players.length === 0) {
            this.rooms.delete(roomCode);
            roomDeleted = true;
        }

        return {
            wasHost,
            roomDeleted,
            newHostId,
            room: roomDeleted ? null : room
        };
    }

    validateStartGame(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            return { valid: false, error: 'Room not found' };
        }

        if (room.hostId !== socketId) {
            return { valid: false, error: 'Only host can start the game' };
        }

        if (room.status === ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game already started' };
        }

        if (room.players.length < ROOM_CONFIG.MIN_PLAYERS_TO_START) {
            return { valid: false, error: `Need at least ${ROOM_CONFIG.MIN_PLAYERS_TO_START} player(s) to start` };
        }

        return { valid: true, error: null };
    }

    startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.status = ROOM_STATUS.PLAYING;
        return room;
    }
}

// Export singleton instance
const roomManager = new RoomManager();
export default roomManager;
