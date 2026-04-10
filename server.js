const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const activeUsers = new Map();
const messageHistory = [];
const rateLimits = new Map();

function checkRateLimit(socketId) {
    const now = Date.now();
    const entry = rateLimits.get(socketId) || { count: 0, resetAt: now + 2000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 2000; }
    entry.count++;
    rateLimits.set(socketId, entry);
    return entry.count > 10; // max 10 messages per 2 seconds
}

io.on('connection', (socket) => {
    console.log(`◇ Unit Linked: ${socket.id}`);

    socket.emit('load history', messageHistory);

    socket.on('user joined', (userData) => {
        if (!userData?.name || typeof userData.name !== 'string') return;
        const user = { name: userData.name.slice(0, 20), id: socket.id };
        activeUsers.set(socket.id, user);
        io.emit('user list', Array.from(activeUsers.values()));
        socket.broadcast.emit('user joined', user);
    });

    socket.on('chat message', (msgData) => {
        if (checkRateLimit(socket.id)) return;
        const user = activeUsers.get(socket.id);
        if (!user || !msgData) return;
        if (typeof msgData.text !== 'string' && !Array.isArray(msgData.files)) return;

        const safeMsg = {
            id: msgData.id || Math.random().toString(36).slice(2),
            user,
            text: typeof msgData.text === 'string' ? msgData.text.slice(0, 2000) : '',
            files: Array.isArray(msgData.files) ? msgData.files : [],
            isAlert: Boolean(msgData.isAlert),
            timestamp: new Date().toLocaleTimeString()
        };

        messageHistory.push(safeMsg);
        if (messageHistory.length > 50) messageHistory.shift();
        socket.broadcast.emit('chat message', safeMsg);
    });

    socket.on('typing', () => {
        const user = activeUsers.get(socket.id);
        if (user) socket.broadcast.emit('typing', { id: socket.id, name: user.name });
    });

    socket.on('typing stop', () => {
        socket.broadcast.emit('typing stop', { id: socket.id });
    });

    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            rateLimits.delete(socket.id);
            activeUsers.delete(socket.id);
            io.emit('user list', Array.from(activeUsers.values()));
            io.emit('user left', user);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`==============================\nBACKROOM ONLINE: PORT ${PORT}\n==============================`);
});
