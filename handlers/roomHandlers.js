/**
 * Room management handlers (reused from OPS backend)
 */

import { SOCKET_EVENTS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import { log } from 'console';

export function registerRoomHandlers(socket, io) {
    // CREATE ROOM
    socket.on(SOCKET_EVENTS.CLIENT.CREATE_ROOM, (data) => {
        try {
            const room = roomManager.createRoom(socket.id, {
                name: data?.name,
                maxPlayers: data?.maxPlayers
            });

            socket.join(room.code);
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_CREATED, { room });
            log(`Room created: ${room.code} by ${socket.id}`);
        } catch (error) {
            log(`Error creating room: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to create room' });
        }
    });

    // JOIN ROOM
    socket.on(SOCKET_EVENTS.CLIENT.JOIN_ROOM, (data) => {
        try {
            const { roomCode, playerName } = data;

            const validation = roomManager.validateJoinRoom(roomCode, socket.id);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: validation.error });
                return;
            }

            const player = roomManager.addPlayerToRoom(roomCode, socket.id, playerName);
            if (!player) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
                return;
            }

            socket.join(roomCode);
            const room = roomManager.getRoom(roomCode);

            socket.emit(SOCKET_EVENTS.SERVER.ROOM_JOINED, { room, player });
            socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_JOINED, { player, room });

            log(`Player ${player.name} joined room: ${roomCode}`);
        } catch (error) {
            log(`Error joining room: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
        }
    });

    // LEAVE ROOM
    socket.on(SOCKET_EVENTS.CLIENT.LEAVE_ROOM, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) return;

            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            if (!result) return;

            socket.leave(roomCode);
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_LEFT, { roomCode });

            if (!result.roomDeleted) {
                const room = roomManager.getRoom(roomCode);
                socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
                    playerId: socket.id,
                    room,
                    newHostId: result.newHostId
                });
            }

            log(`Player left room: ${roomCode}`);
        } catch (error) {
            log(`Error leaving room: ${error.message}`);
        }
    });
}
