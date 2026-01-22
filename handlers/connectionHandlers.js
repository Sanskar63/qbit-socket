/**
 * Connection handlers
 */

import roomManager from '../services/RoomManager.js';
import qbitCityGameStateManager from '../services/QbitCityGameStateManager.js';
import { log } from 'console';

export function registerConnectionHandlers(socket, io) {
    log(`Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
        log(`Client disconnected: ${socket.id}`);
        
        // Handle player leaving room
        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (roomCode) {
            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            
            if (result && !result.roomDeleted) {
                const room = roomManager.getRoom(roomCode);
                if (room) {
                    io.to(roomCode).emit('player_left', {
                        playerId: socket.id,
                        room,
                        newHostId: result.newHostId
                    });
                }
            } else if (result && result.roomDeleted) {
                // Clean up game state
                qbitCityGameStateManager.cleanupRoom(roomCode);
            }
        }
    });
}
