/**
 * Qbit City Game State Management Service
 * Handles authoritative game state for multiplayer Qbit City
 */

import roomManager from './RoomManager.js';
import { GAME_CONFIG } from '../config/constants.js';

const TILE_SIZE = 64;
const MAP_WIDTH = 50;
const MAP_HEIGHT = 50;
const BASE_PLAYER_SPEED = 300;
const BASE_ENEMY_SPEED = 250;
const IMMUNITY_DURATION = 10;
const COLLECTIBLES_START_TIME = 30;
const COINS_FOR_IMMUNITY = 5;
const MAX_IMMUNITY_INVENTORY = 3;

class QbitCityGameStateManager {
    constructor() {
        // Room game state: roomCode -> GameState
        this.roomStates = new Map();
        
        // Input buffers: playerId -> Input[]
        this.inputBuffers = new Map();
        
        // Last update times for throttling
        this.lastUpdateTime = new Map();
    }

    /**
     * Initialize game state for a room
     * @param {string} roomCode - Room code
     * @param {number} mapSeed - Seed for deterministic map generation
     */
    initializeRoom(roomCode, mapSeed = Date.now()) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        // Generate deterministic map
        const map = this.generateMap(mapSeed);
        
        // Initialize boats
        const boats = this.initializeBoats();
        
        // Spawn players at safe positions
        const players = this.initializePlayers(room, map);
        
        // Initialize enemies
        const enemies = [];
        for (let i = 0; i < 3; i++) {
            const enemy = this.spawnEnemy(map, players[0]?.x || 0, players[0]?.y || 0);
            if (enemy) enemies.push(enemy);
        }

        const gameState = {
            roomCode,
            map,
            players,
            enemies,
            boats,
            coins: [],
            immunityPickups: [],
            sinkCollectibles: [],
            deployedSinks: [],
            portals: this.generatePortals(map),
            gameTime: 0,
            enemySpawnTimer: 0,
            coinSpawnTimer: 0,
            immunityPickupSpawnTimer: 0,
            sinkSpawnTimer: 0,
            nextCoinSpawnTime: 10 + Math.random() * 5,
            nextImmunityPickupSpawnTime: 20 + Math.random() * 10,
            nextSinkSpawnTime: 25 + Math.random() * 10,
            collectiblesInitialized: false,
            coinsInitialized: false,
            speedBoostApplied: false,
            mapSeed
        };

        this.roomStates.set(roomCode, gameState);
        return gameState;
    }

    /**
     * Generate deterministic map
     */
    generateMap(seed) {
        // Use seeded random for deterministic generation
        const rng = this.seededRandom(seed);
        
        const tiles = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            const row = [];
            for (let x = 0; x < MAP_WIDTH; x++) {
                row.push(1); // Default to sidewalk
            }
            tiles.push(row);
        }

        // Generate roads (grid pattern)
        const blockSize = 4;
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                const isRoadRow = y % blockSize === 0;
                const isRoadCol = x % blockSize === 0;

                if (isRoadRow || isRoadCol) {
                    tiles[y][x] = 0; // Road
                } else {
                    const rand = rng();
                    if (rand < 0.05) {
                        // Water
                        for (let ly = y - 1; ly <= y + 1; ly++) {
                            for (let lx = x - 1; lx <= x + 1; lx++) {
                                if (ly >= 0 && ly < MAP_HEIGHT && lx >= 0 && lx < MAP_WIDTH) {
                                    if (tiles[ly][lx] !== 0) {
                                        tiles[ly][lx] = 3; // Water
                                    }
                                }
                            }
                        }
                    } else if (rand < 0.15) {
                        tiles[y][x] = 2; // Grass
                    }
                }
            }
        }

        // Set perimeter to lava
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
                    tiles[y][x] = 4; // Lava
                }
            }
        }

        // Generate buildings
        const buildings = [];
        const trees = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                const tile = tiles[y][x];
                const px = x * TILE_SIZE;
                const py = y * TILE_SIZE;

                if (tile === 1) {
                    const rand = rng();
                    let type = 0; // Residential
                    let height = 40 + rng() * 60;
                    let color = '#252525';
                    let wallColor = '#151515';

                    if (rand > 0.9) {
                        type = 1; // Shop
                        height = 30 + rng() * 20;
                        color = '#331133';
                        wallColor = '#220022';
                    } else if (rand > 0.8) {
                        type = 2; // Cafe
                        height = 25 + rng() * 15;
                        color = '#2e3b2e';
                        wallColor = '#1a221a';
                    }

                    buildings.push({
                        gridX: x,
                        gridY: y,
                        x: px,
                        y: py,
                        w: TILE_SIZE,
                        h: TILE_SIZE,
                        height,
                        color,
                        wallColor,
                        type
                    });
                } else if (tile === 2 && rng() > 0.3) {
                    trees.push({
                        x: px + TILE_SIZE / 2 + (rng() * 20 - 10),
                        y: py + TILE_SIZE / 2 + (rng() * 20 - 10),
                        r: 10 + rng() * 10
                    });
                }
            }
        }

        return {
            width: MAP_WIDTH * TILE_SIZE,
            height: MAP_HEIGHT * TILE_SIZE,
            tiles,
            buildings,
            trees
        };
    }

    /**
     * Seeded random number generator
     */
    seededRandom(seed) {
        let value = seed;
        return function() {
            value = (value * 9301 + 49297) % 233280;
            return value / 233280;
        };
    }

    /**
     * Initialize boats
     */
    initializeBoats() {
        const boats = [];
        const perimeter = (MAP_WIDTH * 2 + MAP_HEIGHT * 2) * TILE_SIZE;
        const boatCount = 10;
        const spacing = perimeter / boatCount;

        for (let i = 0; i < boatCount; i++) {
            boats.push({
                id: `boat_${i}`,
                dist: i * spacing,
                x: 0,
                y: 0,
                w: 48,
                h: 48,
                velX: 0,
                velY: 0,
                life: 10.0,
                maxLife: 10.0
            });
        }
        return boats;
    }

    /**
     * Initialize player positions
     */
    initializePlayers(room, map) {
        const players = [];
        
        room.players.forEach((roomPlayer, index) => {
            // Find safe spawn position
            let spawnFound = false;
            let spawnX = 0, spawnY = 0;
            let attempts = 0;

            while (!spawnFound && attempts < 100) {
                attempts++;
                const x = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
                const y = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
                
                if (map.tiles[y][x] === 0) { // Road
                    spawnX = x * TILE_SIZE + TILE_SIZE / 2;
                    spawnY = y * TILE_SIZE + TILE_SIZE / 2;
                    spawnFound = true;
                }
            }

            players.push({
                id: roomPlayer.id,
                name: roomPlayer.name,
                x: spawnX,
                y: spawnY,
                width: 24,
                height: 24,
                speed: BASE_PLAYER_SPEED,
                velX: 0,
                velY: 0,
                dirX: 0,
                dirY: 1,
                trail: [],
                portalCooldown: 0,
                coinsCollected: 0,
                immunityInventory: 0,
                sinkInventory: 0,
                energy: 0,
                immunityActive: false,
                immunityEndTime: 0
            });
        });

        return players;
    }

    /**
     * Generate portals
     */
    generatePortals(map) {
        const portals = [];
        let portalsCreated = 0;
        
        while (portalsCreated < 4) {
            const px = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const py = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
            
            if (map.tiles[py][px] === 0) {
                portals.push({
                    id: `portal_${portalsCreated}`,
                    x: px * TILE_SIZE + TILE_SIZE / 2,
                    y: py * TILE_SIZE + TILE_SIZE / 2,
                    color: `hsl(${portalsCreated * 90}, 100%, 50%)`,
                    angle: 0
                });
                portalsCreated++;
            }
        }
        
        return portals;
    }

    /**
     * Spawn enemy at safe distance from players
     */
    spawnEnemy(map, avoidX, avoidY, minDist = 800) {
        let ex = 0, ey = 0;
        let valid = false;
        let attempts = 0;

        while (!valid && attempts < 100) {
            attempts++;
            const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

            if (map.tiles[ry][rx] === 0) {
                const candidateX = rx * TILE_SIZE + TILE_SIZE / 2;
                const candidateY = ry * TILE_SIZE + TILE_SIZE / 2;
                const d = Math.hypot(candidateX - avoidX, candidateY - avoidY);
                
                if (d > minDist) {
                    ex = candidateX;
                    ey = candidateY;
                    valid = true;
                }
            }
        }

        if (valid) {
            return {
                id: `enemy_${Date.now()}_${Math.random()}`,
                x: ex,
                y: ey,
                width: 24,
                height: 24,
                speed: BASE_ENEMY_SPEED + Math.random() * 30,
                trail: [],
                stuckTime: 0,
                flankTimer: 0,
                flankDir: { x: 0, y: 0 }
            };
        }
        
        return null;
    }

    /**
     * Get game state for a room
     */
    getGameState(roomCode) {
        return this.roomStates.get(roomCode) || null;
    }

    /**
     * Respawn a player after death
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @returns {object|null} - Respawned player data or null if failed
     */
    respawnPlayer(roomCode, playerId) {
        const gameState = this.roomStates.get(roomCode);
        if (!gameState) return null;

        const player = gameState.players.find(p => p.id === playerId);
        if (!player) return null;

        // Find a safe spawn position on road tiles, away from enemies
        let spawnFound = false;
        let spawnX = 0, spawnY = 0;
        let attempts = 0;

        while (!spawnFound && attempts < 100) {
            attempts++;
            const x = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const y = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

            if (gameState.map.tiles[y][x] === 0) { // Road
                const candidateX = x * TILE_SIZE + TILE_SIZE / 2;
                const candidateY = y * TILE_SIZE + TILE_SIZE / 2;

                // Check distance from all enemies
                let safeFromEnemies = true;
                for (const enemy of gameState.enemies) {
                    const dist = Math.hypot(candidateX - enemy.x, candidateY - enemy.y);
                    if (dist < 500) { // Minimum distance from enemies
                        safeFromEnemies = false;
                        break;
                    }
                }

                if (safeFromEnemies) {
                    spawnX = candidateX;
                    spawnY = candidateY;
                    spawnFound = true;
                }
            }
        }

        // Fallback: just find any road tile if no safe spot found
        if (!spawnFound) {
            for (let y = 1; y < MAP_HEIGHT - 1 && !spawnFound; y++) {
                for (let x = 1; x < MAP_WIDTH - 1 && !spawnFound; x++) {
                    if (gameState.map.tiles[y][x] === 0) {
                        spawnX = x * TILE_SIZE + TILE_SIZE / 2;
                        spawnY = y * TILE_SIZE + TILE_SIZE / 2;
                        spawnFound = true;
                    }
                }
            }
        }

        // Reset player state
        player.x = spawnX;
        player.y = spawnY;
        player.velX = 0;
        player.velY = 0;
        player.dirX = 0;
        player.dirY = 1;
        player.trail = [];
        player.coinsCollected = 0;
        player.immunityInventory = 0;
        player.sinkInventory = 0;
        player.energy = 0;
        player.immunityActive = false;
        player.immunityEndTime = 0;
        player.portalCooldown = 0;
        player.speed = BASE_PLAYER_SPEED;

        // Clear input buffer for this player
        this.inputBuffers.delete(playerId);

        return {
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            speed: player.speed
        };
    }

    /**
     * Buffer player input
     */
    bufferPlayerInput(playerId, input, timestamp) {
        if (!this.inputBuffers.has(playerId)) {
            this.inputBuffers.set(playerId, []);
        }
        
        const buffer = this.inputBuffers.get(playerId);
        buffer.push({ ...input, timestamp, processed: false });
        
        // Keep buffer sorted by timestamp
        buffer.sort((a, b) => a.timestamp - b.timestamp);
        
        // Limit buffer size
        if (buffer.length > 60) {
            buffer.shift();
        }
    }

    /**
     * Clean up room state
     */
    cleanupRoom(roomCode) {
        this.roomStates.delete(roomCode);
        
        // Clean up input buffers for players in this room
        const room = roomManager.getRoom(roomCode);
        if (room) {
            room.players.forEach(player => {
                this.inputBuffers.delete(player.id);
                this.lastUpdateTime.delete(player.id);
            });
        }
    }
}

// Export singleton instance
const qbitCityGameStateManager = new QbitCityGameStateManager();
export default qbitCityGameStateManager;
