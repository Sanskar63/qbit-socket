/**
 * Socket.IO server setup for Qbit City
 */

import { Server } from 'socket.io';
import { SERVER_CONFIG } from '../config/constants.js';
import { registerRoomHandlers } from '../handlers/roomHandlers.js';
import { registerQbitCityGameHandlers } from '../handlers/qbitCityGameHandlers.js';
import { registerConnectionHandlers } from '../handlers/connectionHandlers.js';

/**
 * Initialize and configure Socket.IO server
 */
export function setupSocketIO(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: SERVER_CONFIG.CORS_ORIGIN,
            methods: SERVER_CONFIG.CORS_METHODS
        }
    });

    // Register socket connection handler
    io.on('connection', (socket) => {
        registerConnectionHandlers(socket, io);
        registerRoomHandlers(socket, io);
        registerQbitCityGameHandlers(socket, io);
    });

    return io;
}
