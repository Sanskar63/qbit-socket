/**
 * Qbit City Server Entry Point
 */

import express from 'express';
import http from 'http';
import cors from 'cors';
import { log } from 'console';
import { SERVER_CONFIG } from './config/constants.js';
import { setupSocketIO } from './socket/socketSetup.js';
import QbitCityGameLoop from './services/QbitCityGameLoop.js';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO
const io = setupSocketIO(server);

// Initialize game loop
const gameLoop = new QbitCityGameLoop(io);
gameLoop.start();

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'qbit-city-server' });
});

// Start server
const PORT = SERVER_CONFIG.PORT;
server.listen(PORT, () => {
    log(`Qbit City server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down gracefully');
    gameLoop.stop();
    server.close(() => {
        log('Server closed');
        process.exit(0);
    });
});

export { io };
