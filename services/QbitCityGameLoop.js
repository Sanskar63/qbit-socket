/**
 * Qbit City Game Loop Service
 * Server-side game loop that updates game state at fixed intervals
 */

import qbitCityGameStateManager from './QbitCityGameStateManager.js';
import roomManager from './RoomManager.js';
import { ROOM_STATUS } from '../config/constants.js';

const TILE_SIZE = 64;
const MAP_WIDTH = 50;
const MAP_HEIGHT = 50;
const BASE_PLAYER_SPEED = 300;
const BASE_ENEMY_SPEED = 250;
const IMMUNITY_DURATION = 10;
const COLLECTIBLES_START_TIME = 30;
const COINS_FOR_IMMUNITY = 5;
const MAX_IMMUNITY_INVENTORY = 3;

class QbitCityGameLoop {
    constructor(io) {
        this.io = io;
        this.tickRate = 20; // 20 ticks per second
        this.tickInterval = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        const tickDuration = 1000 / this.tickRate;
        
        this.tickInterval = setInterval(() => {
            this.tick();
        }, tickDuration);
        
        console.log(`Qbit City game loop started at ${this.tickRate} Hz`);
    }

    stop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
        this.isRunning = false;
        console.log('Qbit City game loop stopped');
    }

    tick() {
        const deltaTime = 1 / this.tickRate;
        const currentTime = Date.now();
        
        // Update all active game rooms
        roomManager.getAllRooms().forEach(room => {
            if (room.status === ROOM_STATUS.PLAYING) {
                this.updateRoom(room.code, deltaTime, currentTime);
            }
        });
    }

    updateRoom(roomCode, deltaTime, currentTime) {
        const gameState = qbitCityGameStateManager.getGameState(roomCode);
        if (!gameState) return;

        // Update game time
        gameState.gameTime += deltaTime;

        // Process player inputs
        this.processPlayerInputs(gameState, deltaTime, currentTime);

        // Update boats
        this.updateBoats(gameState, deltaTime);

        // Update enemies
        this.updateEnemies(gameState, deltaTime);

        // Handle spawning
        this.handleSpawning(gameState, deltaTime);

        // Update collectibles
        this.updateCollectibles(gameState, deltaTime);

        // Update portals
        this.updatePortals(gameState, deltaTime);

        // Check collisions
        this.checkCollisions(gameState);

        // Broadcast state to all players
        this.broadcastGameState(roomCode, gameState);
    }

    processPlayerInputs(gameState, deltaTime, currentTime) {
        gameState.players.forEach(player => {
            const buffer = qbitCityGameStateManager.inputBuffers.get(player.id) || [];
            
            // Find the most recent unprocessed input (to avoid processing multiple inputs at once)
            let latestInput = null;
            let latestIndex = -1;
            
            for (let i = buffer.length - 1; i >= 0; i--) {
                const input = buffer[i];
                if (!input.processed && input.timestamp <= currentTime) {
                    if (!latestInput || input.timestamp > latestInput.timestamp) {
                        latestInput = input;
                        latestIndex = i;
                    }
                }
            }
            
            // Process only the most recent input per tick (prevents multiple movements in one frame)
            if (latestInput) {
                this.applyInputToPlayer(player, latestInput, deltaTime, gameState);
                latestInput.processed = true;
                
                // Mark older inputs as processed too (they're superseded by the latest)
                for (let i = 0; i < latestIndex; i++) {
                    if (buffer[i].timestamp <= currentTime) {
                        buffer[i].processed = true;
                    }
                }
            }

            // Remove old processed inputs
            const activeBuffer = buffer.filter(
                input => !input.processed || (currentTime - input.timestamp < 1000)
            );
            qbitCityGameStateManager.inputBuffers.set(player.id, activeBuffer);
        });
    }

    applyInputToPlayer(player, input, deltaTime, gameState) {
        const keys = input.keys || {};
        
        // Calculate movement direction
        let dx = 0, dy = 0;
        if (keys.ArrowUp || keys.KeyW) dy = -1;
        if (keys.ArrowDown || keys.KeyS) dy = 1;
        if (keys.ArrowLeft || keys.KeyA) dx = -1;
        if (keys.ArrowRight || keys.KeyD) dx = 1;

        if (dx !== 0 || dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
            player.dirX = dx;
            player.dirY = dy;
        }

        // Set velocity directly (matches original single-player behavior, no interpolation)
        player.velX = dx * player.speed;
        player.velY = dy * player.speed;

        // Apply movement with collision
        const newX = player.x + player.velX * deltaTime;
        const newY = player.y + player.velY * deltaTime;

        if (this.checkCollision(newX, player.y, player.width, player.height, gameState.map, true)) {
            // X collision, try Y only
            if (!this.checkCollision(player.x, newY, player.width, player.height, gameState.map, true)) {
                player.y = newY;
            }
        } else if (this.checkCollision(player.x, newY, player.width, player.height, gameState.map, true)) {
            // Y collision, use X only
            player.x = newX;
        } else {
            // No collision, move both
            player.x = newX;
            player.y = newY;
        }

        // Update energy
        if (dx !== 0 || dy !== 0) {
            player.energy = Math.min(1, player.energy + deltaTime * 0.3);
        }

        // Update trail (only when moving)
        if (dx !== 0 || dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 20) player.trail.shift();
        }

        // Update portal cooldown
        if (player.portalCooldown > 0) {
            player.portalCooldown -= deltaTime;
        }

        // Update immunity
        if (player.immunityActive && gameState.gameTime >= player.immunityEndTime) {
            player.immunityActive = false;
        }
    }

    updateBoats(gameState, deltaTime) {
        const speed = 150;
        const totalDist = (MAP_WIDTH - 1 + MAP_HEIGHT - 1) * 2 * TILE_SIZE;

        gameState.boats.forEach(boat => {
            boat.dist = (boat.dist + speed * deltaTime) % totalDist;

            const topLen = (MAP_WIDTH - 1) * TILE_SIZE;
            const rightLen = (MAP_HEIGHT - 1) * TILE_SIZE;
            const bottomLen = (MAP_WIDTH - 1) * TILE_SIZE;

            let currentDist = boat.dist;
            let nx = 0, ny = 0;

            if (currentDist < topLen) {
                nx = currentDist;
                ny = 0;
                boat.velX = speed;
                boat.velY = 0;
            } else if (currentDist < topLen + rightLen) {
                currentDist -= topLen;
                nx = (MAP_WIDTH - 1) * TILE_SIZE;
                ny = currentDist;
                boat.velX = 0;
                boat.velY = speed;
            } else if (currentDist < topLen + rightLen + bottomLen) {
                currentDist -= topLen + rightLen;
                nx = (MAP_WIDTH - 1) * TILE_SIZE - currentDist;
                ny = (MAP_HEIGHT - 1) * TILE_SIZE;
                boat.velX = -speed;
                boat.velY = 0;
            } else {
                currentDist -= topLen + rightLen + bottomLen;
                nx = 0;
                ny = (MAP_HEIGHT - 1) * TILE_SIZE - currentDist;
                boat.velX = 0;
                boat.velY = -speed;
            }

            boat.x = nx + TILE_SIZE / 2;
            boat.y = ny + TILE_SIZE / 2;
        });
    }

    updateEnemies(gameState, deltaTime) {
        gameState.enemies.forEach(enemy => {
            // Find nearest player
            let nearestPlayer = null;
            let minDist = Infinity;

            gameState.players.forEach(player => {
                const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearestPlayer = player;
                }
            });

            if (!nearestPlayer) return;

            // Calculate direction to player
            let moveX = 0, moveY = 0;

            if (enemy.flankTimer > 0) {
                enemy.flankTimer -= deltaTime;
                moveX = enemy.flankDir.x * enemy.speed * deltaTime;
                moveY = enemy.flankDir.y * enemy.speed * deltaTime;
                if (enemy.flankTimer <= 0) enemy.stuckTime = 0;
            } else {
                const edx = nearestPlayer.x - enemy.x;
                const edy = nearestPlayer.y - enemy.y;
                const dist = Math.hypot(edx, edy);

                if (dist > 0) {
                    moveX = (edx / dist) * enemy.speed * deltaTime;
                    moveY = (edy / dist) * enemy.speed * deltaTime;
                }
            }

            // Apply movement with collision
            let actualX = 0, actualY = 0;
            if (!this.checkCollision(enemy.x + moveX, enemy.y, enemy.width, enemy.height, gameState.map, false)) {
                enemy.x += moveX;
                actualX = moveX;
            }
            if (!this.checkCollision(enemy.x, enemy.y + moveY, enemy.width, enemy.height, gameState.map, false)) {
                enemy.y += moveY;
                actualY = moveY;
            }

            // Stuck detection
            if (enemy.flankTimer <= 0) {
                const intended = enemy.speed * deltaTime;
                const actual = Math.hypot(actualX, actualY);
                
                if (actual < intended * 0.5) {
                    enemy.stuckTime += deltaTime;
                    if (enemy.stuckTime > 0.5) {
                        enemy.flankTimer = 1.0;
                        const edx = nearestPlayer.x - enemy.x;
                        const edy = nearestPlayer.y - enemy.y;
                        const dist = Math.hypot(edx, edy);
                        if (dist > 0) {
                            const edxNorm = edx / dist;
                            const edyNorm = edy / dist;
                            if (Math.random() < 0.5) {
                                enemy.flankDir = { x: -edyNorm, y: edxNorm };
                            } else {
                                enemy.flankDir = { x: edyNorm, y: -edxNorm };
                            }
                        }
                    }
                } else {
                    enemy.stuckTime = Math.max(0, enemy.stuckTime - deltaTime);
                }
            }

            // Update trail
            enemy.trail.push({ x: enemy.x, y: enemy.y });
            if (enemy.trail.length > 20) enemy.trail.shift();
        });
    }

    handleSpawning(gameState, deltaTime) {
        // Speed boost at 30 seconds
        if (!gameState.speedBoostApplied && gameState.gameTime >= 30) {
            gameState.speedBoostApplied = true;
            gameState.players.forEach(player => {
                player.speed = BASE_PLAYER_SPEED * 1.2;
            });
            gameState.enemies.forEach(enemy => {
                enemy.speed = enemy.speed * 1.2;
            });
        }

        // Spawn coins
        if (!gameState.coinsInitialized) {
            gameState.coinsInitialized = true;
            for (let i = 0; i < 20; i++) {
                this.spawnCoin(gameState);
            }
        }

        gameState.coinSpawnTimer += deltaTime;
        if (gameState.coinSpawnTimer >= gameState.nextCoinSpawnTime) {
            gameState.coinSpawnTimer = 0;
            gameState.nextCoinSpawnTime = 3 + Math.random() * 4;
            const numCoins = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < numCoins; i++) {
                this.spawnCoin(gameState);
            }
        }

        // Spawn other collectibles after 30 seconds
        if (gameState.gameTime >= COLLECTIBLES_START_TIME) {
            if (!gameState.collectiblesInitialized) {
                gameState.collectiblesInitialized = true;
                // Spawn initial immunity pickups
                for (let q = 0; q < 4; q++) {
                    this.spawnImmunityPickup(gameState, q);
                }
                this.spawnSinkCollectible(gameState);
            }

            // Regular spawn timers
            gameState.immunityPickupSpawnTimer += deltaTime;
            if (gameState.immunityPickupSpawnTimer >= gameState.nextImmunityPickupSpawnTime) {
                gameState.immunityPickupSpawnTimer = 0;
                gameState.nextImmunityPickupSpawnTime = 25 + Math.random() * 15;
                
                const quadrantCounts = [0, 0, 0, 0];
                gameState.immunityPickups.forEach(p => {
                    if (!p.collected) quadrantCounts[p.quadrant]++;
                });
                
                for (let q = 0; q < 4; q++) {
                    if (quadrantCounts[q] < 2) {
                        this.spawnImmunityPickup(gameState, q);
                    }
                }
            }

            gameState.sinkSpawnTimer += deltaTime;
            if (gameState.sinkSpawnTimer >= gameState.nextSinkSpawnTime) {
                gameState.sinkSpawnTimer = 0;
                gameState.nextSinkSpawnTime = 25 + Math.random() * 10;
                this.spawnSinkCollectible(gameState);
            }
        }

        // Spawn enemies
        gameState.enemySpawnTimer += deltaTime;
        if (gameState.enemySpawnTimer >= 30) {
            gameState.enemySpawnTimer = 0;
            const centerX = gameState.players[0]?.x || 0;
            const centerY = gameState.players[0]?.y || 0;
            for (let i = 0; i < 2; i++) {
                const enemy = qbitCityGameStateManager.spawnEnemy(
                    gameState.map,
                    centerX,
                    centerY
                );
                if (enemy) {
                    if (gameState.speedBoostApplied) {
                        enemy.speed = enemy.speed * 1.2;
                    }
                    gameState.enemies.push(enemy);
                }
            }
        }
    }

    spawnCoin(gameState) {
        if (gameState.coins.filter(c => !c.collected).length >= 40) return;

        let attempts = 0;
        while (attempts < 100) {
            attempts++;
            const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

            if (gameState.map.tiles[ry]?.[rx] === 0) {
                const cx = rx * TILE_SIZE + TILE_SIZE / 2;
                const cy = ry * TILE_SIZE + TILE_SIZE / 2;
                
                // Check distance from all players
                let tooClose = false;
                for (const player of gameState.players) {
                    const d = Math.hypot(cx - player.x, cy - player.y);
                    if (d < 200) {
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose) {
                    gameState.coins.push({
                        id: `coin_${Date.now()}_${Math.random()}`,
                        x: cx,
                        y: cy,
                        collected: false,
                        spawnTime: Date.now() * 0.001
                    });
                    return;
                }
            }
        }
    }

    spawnImmunityPickup(gameState, quadrant) {
        const midX = MAP_WIDTH / 2;
        const midY = MAP_HEIGHT / 2;

        let minX = 1, maxX = midX - 1, minY = 1, maxY = midY - 1;
        if (quadrant === 1) { minX = midX; maxX = MAP_WIDTH - 2; }
        if (quadrant === 2) { minY = midY; maxY = MAP_HEIGHT - 2; }
        if (quadrant === 3) { minX = midX; maxX = MAP_WIDTH - 2; minY = midY; maxY = MAP_HEIGHT - 2; }

        let attempts = 0;
        while (attempts < 100) {
            attempts++;
            const rx = Math.floor(minX + Math.random() * (maxX - minX));
            const ry = Math.floor(minY + Math.random() * (maxY - minY));

            if (gameState.map.tiles[ry]?.[rx] === 0) {
                const cx = rx * TILE_SIZE + TILE_SIZE / 2;
                const cy = ry * TILE_SIZE + TILE_SIZE / 2;

                gameState.immunityPickups.push({
                    id: `immunity_${Date.now()}_${Math.random()}`,
                    x: cx,
                    y: cy,
                    collected: false,
                    quadrant,
                    spawnTime: Date.now() * 0.001
                });
                return;
            }
        }
    }

    spawnSinkCollectible(gameState) {
        if (gameState.sinkCollectibles.filter(s => !s.collected).length >= 2) return;

        let attempts = 0;
        while (attempts < 100) {
            attempts++;
            const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

            if (gameState.map.tiles[ry]?.[rx] === 0) {
                const cx = rx * TILE_SIZE + TILE_SIZE / 2;
                const cy = ry * TILE_SIZE + TILE_SIZE / 2;

                let tooClose = false;
                for (const player of gameState.players) {
                    const d = Math.hypot(cx - player.x, cy - player.y);
                    if (d < 300) {
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose) {
                    gameState.sinkCollectibles.push({
                        id: `sink_${Date.now()}_${Math.random()}`,
                        x: cx,
                        y: cy,
                        collected: false,
                        spawnTime: Date.now() * 0.001
                    });
                    return;
                }
            }
        }
    }

    updateCollectibles(gameState, deltaTime) {
        // Coins, immunity pickups, sink collectibles are static
        // Just remove collected ones
        gameState.coins = gameState.coins.filter(c => !c.collected);
        gameState.immunityPickups = gameState.immunityPickups.filter(p => !p.collected);
        gameState.sinkCollectibles = gameState.sinkCollectibles.filter(s => !s.collected);
    }

    updatePortals(gameState, deltaTime) {
        gameState.portals.forEach(portal => {
            portal.angle += 2 * deltaTime;
            if (portal.life !== undefined) {
                portal.life -= deltaTime;
            }
        });

        // Remove expired portals
        gameState.portals = gameState.portals.filter(p => !p.life || p.life > 0);
    }

    checkCollisions(gameState) {
        // Player-enemy collisions and lava death
        gameState.players.forEach(player => {
            // Check if player is on lava tile
            const gridX = Math.floor(player.x / TILE_SIZE);
            const gridY = Math.floor(player.y / TILE_SIZE);
            
            if (gridY >= 0 && gridY < MAP_HEIGHT && gridX >= 0 && gridX < MAP_WIDTH) {
                const tile = gameState.map.tiles[gridY][gridX];
                if (tile === 4) {
                    // Check if player is on a boat (boats save from lava)
                    const onBoat = gameState.boats.some(boat => {
                        const dx = player.x - boat.x;
                        const dy = player.y - boat.y;
                        return Math.abs(dx) < boat.w / 2 + player.width / 2 &&
                               Math.abs(dy) < boat.h / 2 + player.height / 2;
                    });
                    
                    if (!onBoat) {
                        // Player death from lava
                        this.io.to(gameState.roomCode).emit('player_death', {
                            playerId: player.id
                        });
                        return; // Skip further collision checks for this player
                    }
                }
            }
            
            // Enemy collisions
            gameState.enemies.forEach(enemy => {
                const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
                if (dist < (player.width / 2 + enemy.width / 2)) {
                    if (!player.immunityActive) {
                        // Player death - handled by game handler
                        this.io.to(gameState.roomCode).emit('player_death', {
                            playerId: player.id
                        });
                    } else {
                        // Push enemy away
                        const newPos = qbitCityGameStateManager.spawnEnemy(
                            gameState.map,
                            player.x,
                            player.y,
                            500
                        );
                        if (newPos) {
                            enemy.x = newPos.x;
                            enemy.y = newPos.y;
                            enemy.trail = [];
                        }
                    }
                }
            });

            // Player-collectible collisions
            gameState.coins.forEach(coin => {
                if (coin.collected) return;
                const d = Math.hypot(player.x - coin.x, player.y - coin.y);
                if (d < 25) {
                    coin.collected = true;
                    player.coinsCollected++;
                    
                    if (player.coinsCollected >= COINS_FOR_IMMUNITY) {
                        if (player.immunityInventory < MAX_IMMUNITY_INVENTORY) {
                            player.immunityInventory++;
                            player.coinsCollected = 0;
                        } else {
                            player.coinsCollected = COINS_FOR_IMMUNITY - 1;
                        }
                    }
                }
            });

            gameState.immunityPickups.forEach(pickup => {
                if (pickup.collected) return;
                const d = Math.hypot(player.x - pickup.x, player.y - pickup.y);
                if (d < 30) {
                    pickup.collected = true;
                    player.immunityActive = true;
                    player.immunityEndTime = gameState.gameTime + IMMUNITY_DURATION;
                }
            });

            gameState.sinkCollectibles.forEach(sink => {
                if (sink.collected) return;
                const d = Math.hypot(player.x - sink.x, player.y - sink.y);
                if (d < 30) {
                    if (player.sinkInventory < 3) {
                        sink.collected = true;
                        player.sinkInventory++;
                    }
                }
            });

            // Player-portal collisions
            if (player.portalCooldown <= 0) {
                gameState.portals.forEach((portal, i) => {
                    const d = Math.hypot(player.x - portal.x, player.y - portal.y);
                    if (d < 20) {
                        const otherPortals = gameState.portals.filter((_, idx) => idx !== i);
                        if (otherPortals.length > 0) {
                            const dest = otherPortals[Math.floor(Math.random() * otherPortals.length)];
                            player.x = dest.x;
                            player.y = dest.y;
                            player.portalCooldown = 2.0;
                            player.trail = [];
                        }
                    }
                });
            }

            // Enemy-sink collisions
            gameState.enemies.forEach(enemy => {
                for (let i = gameState.deployedSinks.length - 1; i >= 0; i--) {
                    const sink = gameState.deployedSinks[i];
                    const d = Math.hypot(enemy.x - sink.x, enemy.y - sink.y);
                    if (d < 25) {
                        gameState.deployedSinks.splice(i, 1);
                        const newPos = qbitCityGameStateManager.spawnEnemy(
                            gameState.map,
                            player.x,
                            player.y,
                            1000
                        );
                        if (newPos) {
                            enemy.x = newPos.x;
                            enemy.y = newPos.y;
                            enemy.trail = [];
                        }
                    }
                }
            });
        });
    }

    checkCollision(x, y, width, height, map, isPlayer) {
        const halfW = width / 2;
        const halfH = height / 2;
        const l = x - halfW;
        const r = x + halfW;
        const t = y - halfH;
        const b = y + halfH;
        const gridX = Math.floor(x / TILE_SIZE);
        const gridY = Math.floor(y / TILE_SIZE);

        for (let gy = gridY - 1; gy <= gridY + 1; gy++) {
            for (let gx = gridX - 1; gx <= gridX + 1; gx++) {
                if (gy >= 0 && gy < MAP_HEIGHT && gx >= 0 && gx < MAP_WIDTH) {
                    const tile = map.tiles[gy][gx];
                    let solid = tile === 1 || tile === 3;
                    if (tile === 4 && !isPlayer) solid = true;

                    if (solid) {
                        const bx = gx * TILE_SIZE;
                        const by = gy * TILE_SIZE;
                        if (l < bx + TILE_SIZE && r > bx && t < by + TILE_SIZE && b > by) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    broadcastGameState(roomCode, gameState) {
        // Create sanitized state for clients
        const clientState = {
            players: gameState.players.map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                velX: p.velX,
                velY: p.velY,
                dirX: p.dirX,
                dirY: p.dirY,
                speed: p.speed,
                trail: p.trail || [],
                coinsCollected: p.coinsCollected,
                immunityInventory: p.immunityInventory,
                sinkInventory: p.sinkInventory,
                energy: p.energy,
                immunityActive: p.immunityActive,
                immunityEndTime: p.immunityEndTime
            })),
            enemies: gameState.enemies,
            boats: gameState.boats,
            coins: gameState.coins.filter(c => !c.collected),
            immunityPickups: gameState.immunityPickups.filter(p => !p.collected),
            sinkCollectibles: gameState.sinkCollectibles.filter(s => !s.collected),
            deployedSinks: gameState.deployedSinks,
            portals: gameState.portals,
            gameTime: gameState.gameTime,
            timestamp: Date.now()
        };

        this.io.to(roomCode).emit('game_state', clientState);
    }
}

export default QbitCityGameLoop;
