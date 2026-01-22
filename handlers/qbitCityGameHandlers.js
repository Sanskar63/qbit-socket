/**
 * Qbit City game event handlers
 */

import { SOCKET_EVENTS, ROOM_STATUS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import qbitCityGameStateManager from '../services/QbitCityGameStateManager.js';
import { log } from 'console';

/**
 * Register Qbit City game handlers
 */
export function registerQbitCityGameHandlers(socket, io) {
    // START GAME
    socket.on(SOCKET_EVENTS.CLIENT.START_GAME, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Not in any room' });
                return;
            }

            const validation = roomManager.validateStartGame(roomCode, socket.id);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: validation.error });
                return;
            }

            // Start the game
            const room = roomManager.startGame(roomCode);
            if (!room) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
                return;
            }

            // Initialize game state
            const gameState = qbitCityGameStateManager.initializeRoom(roomCode);
            if (!gameState) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to initialize game' });
                return;
            }

            log(`Qbit City game started in room: ${roomCode}`);

            // Notify all players
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, {
                room,
                gameState: {
                    map: gameState.map,
                    players: gameState.players,
                    enemies: gameState.enemies,
                    boats: gameState.boats,
                    coins: gameState.coins,
                    immunityPickups: gameState.immunityPickups,
                    sinkCollectibles: gameState.sinkCollectibles,
                    portals: gameState.portals,
                    gameTime: 0
                }
            });
        } catch (error) {
            log(`Error starting Qbit City game: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
        }
    });

    // PLAYER INPUT
    socket.on(SOCKET_EVENTS.CLIENT.PLAYER_INPUT, (inputData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) return;

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) return;

            // Buffer input with timestamp
            qbitCityGameStateManager.bufferPlayerInput(
                socket.id,
                inputData,
                inputData.timestamp || Date.now()
            );
        } catch (error) {
            log(`Error handling player input: ${error.message}`);
        }
    });

    // USE PORTAL
    socket.on(SOCKET_EVENTS.CLIENT.USE_PORTAL, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) return;

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) return;

            const gameState = qbitCityGameStateManager.getGameState(roomCode);
            if (!gameState) return;

            const player = gameState.players.find(p => p.id === socket.id);
            if (!player) return;

            if (player.energy < 1) {
                socket.emit('action_error', { message: 'Energy not full' });
                return;
            }

            // Create portal 1 second ahead of player
            const spawnDist = player.speed * 1;
            const px = player.x + player.dirX * spawnDist;
            const py = player.y + player.dirY * spawnDist;

            gameState.portals.push({
                id: `portal_${Date.now()}_${Math.random()}`,
                x: px,
                y: py,
                color: '#ff00ff',
                angle: 0,
                life: 10.0,
                isPlayerCreated: true
            });

            player.energy = 0;

            // Broadcast portal creation
            io.to(roomCode).emit('portal_created', {
                portal: gameState.portals[gameState.portals.length - 1]
            });
        } catch (error) {
            log(`Error using portal: ${error.message}`);
        }
    });

    // DEPLOY SINK
    socket.on(SOCKET_EVENTS.CLIENT.DEPLOY_SINK, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) return;

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) return;

            const gameState = qbitCityGameStateManager.getGameState(roomCode);
            if (!gameState) return;

            const player = gameState.players.find(p => p.id === socket.id);
            if (!player) return;

            if (player.sinkInventory <= 0) {
                socket.emit('action_error', { message: 'No sink traps' });
                return;
            }

            player.sinkInventory--;
            gameState.deployedSinks.push({
                id: `sink_${Date.now()}_${Math.random()}`,
                x: player.x,
                y: player.y,
                deployTime: gameState.gameTime
            });

            // Broadcast sink deployment
            io.to(roomCode).emit('sink_deployed', {
                sink: gameState.deployedSinks[gameState.deployedSinks.length - 1],
                playerId: socket.id
            });
        } catch (error) {
            log(`Error deploying sink: ${error.message}`);
        }
    });

    // ACTIVATE IMMUNITY
    socket.on(SOCKET_EVENTS.CLIENT.ACTIVATE_IMMUNITY, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) return;

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) return;

            const gameState = qbitCityGameStateManager.getGameState(roomCode);
            if (!gameState) return;

            const player = gameState.players.find(p => p.id === socket.id);
            if (!player) return;

            if (player.immunityInventory <= 0) {
                socket.emit('action_error', { message: 'No immunity stored' });
                return;
            }

            if (player.immunityActive) {
                socket.emit('action_error', { message: 'Immunity already active' });
                return;
            }

            player.immunityInventory--;
            player.immunityActive = true;
            player.immunityEndTime = gameState.gameTime + 10; // 10 seconds

            // Broadcast immunity activation
            io.to(roomCode).emit('immunity_activated', {
                playerId: socket.id
            });
        } catch (error) {
            log(`Error activating immunity: ${error.message}`);
        }
    });

    // RESPAWN PLAYER (Play Again)
    socket.on(SOCKET_EVENTS.CLIENT.RESPAWN_PLAYER, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit('action_error', { message: 'Not in any room' });
                return;
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                socket.emit('action_error', { message: 'Game not active' });
                return;
            }

            // Respawn the player
            const respawnedPlayer = qbitCityGameStateManager.respawnPlayer(roomCode, socket.id);
            if (!respawnedPlayer) {
                socket.emit('action_error', { message: 'Failed to respawn' });
                return;
            }

            log(`Player respawned in room ${roomCode}: ${socket.id}`);

            // Notify the player that they've been respawned
            socket.emit(SOCKET_EVENTS.SERVER.PLAYER_RESPAWNED, {
                player: respawnedPlayer,
                gameState: qbitCityGameStateManager.getGameState(roomCode)
            });

            // Notify other players about the respawn
            socket.to(roomCode).emit('player_rejoined', {
                playerId: socket.id,
                playerName: respawnedPlayer.name
            });
        } catch (error) {
            log(`Error respawning player: ${error.message}`);
            socket.emit('action_error', { message: 'Failed to respawn' });
        }
    });

    // GET GAME STATE
    socket.on(SOCKET_EVENTS.CLIENT.GET_GAME_STATE, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE, { gameState: null });
                return;
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE, { gameState: null });
                return;
            }

            const gameState = qbitCityGameStateManager.getGameState(roomCode);
            if (!gameState) {
                socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE, { gameState: null });
                return;
            }

            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE, {
                gameState: {
                    map: gameState.map,
                    players: gameState.players,
                    enemies: gameState.enemies,
                    boats: gameState.boats,
                    coins: gameState.coins.filter(c => !c.collected),
                    immunityPickups: gameState.immunityPickups.filter(p => !p.collected),
                    sinkCollectibles: gameState.sinkCollectibles.filter(s => !s.collected),
                    deployedSinks: gameState.deployedSinks,
                    portals: gameState.portals,
                    gameTime: gameState.gameTime
                }
            });
        } catch (error) {
            log(`Error getting game state: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE, { gameState: null });
        }
    });
}
