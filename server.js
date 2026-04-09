const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// FIXED: Increased buffer size to 100MB for video transmissions
const io = new Server(server, {
    maxHttpBufferSize: 1e8 
});

app.use(express.static(path.join(__dirname, 'public')));

// THE ENTITY MAP: Stores active users indexed by their Socket ID
const activeUsers = new Map();
const messageHistory = []; // Optional: Stores last 50 messages for new joins

io.on('connection', (socket) => {
    console.log(`◇ New connection established: ${socket.id}`);

    // 1. Initial connection: Send history to the new unit
    socket.emit('load history', messageHistory);

    // 2. User Joined: Add to Map and broadcast the updated list
    socket.on('user joined', (userData) => {
        // Ensure the ID is pinned to the socket for reliability
        const user = { ...userData, id: socket.id };
        activeUsers.set(socket.id, user);
        
        console.log(`◉ Entity Authenticated: ${user.name}`);
        
        // Broadcast to everyone: Updated entity list
        io.emit('user list', Array.from(activeUsers.values()));
        
        // Notify others
        socket.broadcast.emit('user joined', user);
    });

    // 3. Messaging: Relay with history logging
    socket.on('chat message', (msgData) => {
        // Log to history (keep only last 50)
        messageHistory.push(msgData);
        if (messageHistory.length > 50) messageHistory.shift();

        // Broadcast to everyone except the sender (who did an optimistic render)
        socket.broadcast.emit('chat message', msgData);
    });

    // 4. Typing Status
    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    // 5. Disconnect: Clean up the map
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            console.log(`◌ Signal Lost: ${user.name}`);
            activeUsers.delete(socket.id);
            
            // Broadcast the updated list and departure notification
            io.emit('user list', Array.from(activeUsers.values()));
            io.emit('user left', user);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ====================================
    BACKROOM TERMINAL ONLINE
    Access Point: http://localhost:${PORT}
    Data Limit: 100MB
    ====================================
    `);
});