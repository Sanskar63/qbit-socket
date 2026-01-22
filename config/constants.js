/**
 * Qbit City constants and configuration
 */

export const ROOM_CONFIG = {
    DEFAULT_MAX_PLAYERS: 4,
    ROOM_CODE_LENGTH: 6,
    ROOM_CODE_CHARS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    MIN_PLAYERS_TO_START: 1 // Can start solo or with others
};

export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

export const SERVER_CONFIG = {
    PORT: 3001, // Different port from OPS backend
    CORS_ORIGIN: '*',
    CORS_METHODS: ['GET', 'POST']
};

export const SOCKET_EVENTS = {
    // Client -> Server
    CLIENT: {
        CREATE_ROOM: 'create_room',
        JOIN_ROOM: 'join_room',
        LEAVE_ROOM: 'leave_room',
        START_GAME: 'start_game',
        PLAYER_INPUT: 'player_input',
        USE_PORTAL: 'use_portal',
        DEPLOY_SINK: 'deploy_sink',
        ACTIVATE_IMMUNITY: 'activate_immunity',
        GET_GAME_STATE: 'get_game_state',
        RESPAWN_PLAYER: 'respawn_player'
    },
    // Server -> Client
    SERVER: {
        ROOM_CREATED: 'room_created',
        ROOM_JOINED: 'room_joined',
        PLAYER_JOINED: 'player_joined',
        PLAYER_LEFT: 'player_left',
        ROOM_UPDATE: 'room_update',
        GAME_STARTED: 'game_started',
        GAME_STATE: 'game_state',
        PLAYER_DEATH: 'player_death',
        PLAYER_RESPAWNED: 'player_respawned',
        COLLECTIBLE_COLLECTED: 'collectible_collected',
        JOIN_ERROR: 'join_error',
        START_ERROR: 'start_error'
    }
};

export const GAME_CONFIG = {
    TICK_RATE: 20, // Server ticks per second
    INPUT_BUFFER_SIZE: 60,
    MAX_INPUT_LAG: 1000 // ms
};
