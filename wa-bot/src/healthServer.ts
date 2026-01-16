import http from 'http';
import pino from 'pino';

const logger = pino({ level: 'info' });

interface HealthStatus {
    status: 'connected' | 'disconnected' | 'connecting';
    uptime: number;
    lastConnected?: string;
    lastDisconnected?: string;
}

type ConnectionGetter = () => boolean;

let getConnectionStatus: ConnectionGetter = () => false;
const startTime = Date.now();
let lastConnectedTime: Date | null = null;
let lastDisconnectedTime: Date | null = null;

export function setConnectionGetter(getter: ConnectionGetter) {
    getConnectionStatus = getter;
}

export function notifyConnected() {
    lastConnectedTime = new Date();
}

export function notifyDisconnected() {
    lastDisconnectedTime = new Date();
}

function getHealthStatus(): HealthStatus {
    const isConnected = getConnectionStatus();
    return {
        status: isConnected ? 'connected' : 'disconnected',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        ...(lastConnectedTime && { lastConnected: lastConnectedTime.toISOString() }),
        ...(lastDisconnectedTime && { lastDisconnected: lastDisconnectedTime.toISOString() }),
    };
}

export function startHealthServer(port: number = 3000): http.Server {
    const server = http.createServer((req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
            const status = getHealthStatus();
            const statusCode = status.status === 'connected' ? 200 : 503;

            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(port, () => {
        logger.info(`Health server listening on port ${port}`);
    });

    return server;
}
