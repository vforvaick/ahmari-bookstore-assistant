"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setConnectionGetter = setConnectionGetter;
exports.notifyConnected = notifyConnected;
exports.notifyDisconnected = notifyDisconnected;
exports.startHealthServer = startHealthServer;
const http_1 = __importDefault(require("http"));
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
let getConnectionStatus = () => false;
const startTime = Date.now();
let lastConnectedTime = null;
let lastDisconnectedTime = null;
function setConnectionGetter(getter) {
    getConnectionStatus = getter;
}
function notifyConnected() {
    lastConnectedTime = new Date();
}
function notifyDisconnected() {
    lastDisconnectedTime = new Date();
}
function getHealthStatus() {
    const isConnected = getConnectionStatus();
    return {
        status: isConnected ? 'connected' : 'disconnected',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        ...(lastConnectedTime && { lastConnected: lastConnectedTime.toISOString() }),
        ...(lastDisconnectedTime && { lastDisconnected: lastDisconnectedTime.toISOString() }),
    };
}
function startHealthServer(port = 3000) {
    const server = http_1.default.createServer((req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
            const status = getHealthStatus();
            const statusCode = status.status === 'connected' ? 200 : 503;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });
    server.listen(port, () => {
        logger.info(`Health server listening on port ${port}`);
    });
    return server;
}
