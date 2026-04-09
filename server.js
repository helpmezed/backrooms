const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// FIX: Increase buffer to 100MB for high-res videos/images
const io = new Server(server, {
    maxHttpBufferSize: 1e8 
});

// FIX: Serve files from the root directory so index.html is found
app.use(express.static(__dirname));

// Backup Route: Explicitly send index.html when someone visits
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const activeUsers = new Map();
const messageHistory = [];

io.on('connection', (socket) => {
    console.log(`◇ Unit Linked: ${socket.id}`);

    // Load last 50 messages for the new unit
    socket.emit('load history', messageHistory);

    socket.on('user joined', (userData) => {
        // Pin the socket ID to the user object for reliable UI rendering
        const user = { ...userData, id: socket.id };
        activeUsers.set(socket.id, user);
        
        // Broadcast updated entity list
        io.emit('user list', Array.from(activeUsers.values()));
        socket.broadcast.emit('user joined', user);
    });

    socket.on('chat message', (msgData) => {
        messageHistory.push(msgData);
        if (messageHistory.length > 50) messageHistory.shift();
        
        // Relay to all other connected units
        socket.broadcast.emit('chat message', msgData);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
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