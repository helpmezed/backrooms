const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');

const app = express();
const http = require('http').Server(app);

// Initialize Socket.io with a 10MB upload limit for images/gifs
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 
});

// --- Middleware ---
// helmet() adds security headers to protect against common web vulnerabilities
app.use(helmet({
    contentSecurityPolicy: false, // Set to false to allow external fonts/scripts like Google Fonts
}));

// compression() reduces the size of the response body, making the app load faster
app.use(compression());

// --- Chat History ---
// Stores the last 5 messages so the chat isn't empty upon connection
let messageHistory = []; 

// --- Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Socket Logic ---
io.on('connection', (socket) => {
    
    // 1. Update User Count
    // Tell everyone the new total user count immediately
    io.emit('user count', io.engine.clientsCount);
    console.log(`Connection established. Active Nodes: ${io.engine.clientsCount}`);
    
    // 2. Sync History
    // Send the last 5 messages to the new user for context
    socket.emit('load history', messageHistory);

    // 3. Messaging Logic
    socket.on('chat message', (data) => {
        // Basic Sanitization: Strip HTML tags to prevent XSS
        if (data.text) {
            data.text = data.text.replace(/<[^>]*>?/gm, ''); 
        }

        // Manage history queue (Maintains only the last 5)
        messageHistory.push(data);
        if (messageHistory.length > 5) {
            messageHistory.shift();
        }
        
        // Broadcast the message to all connected clients
        io.emit('chat message', data); 
    });

    // 4. Typing Indicators
    // Listen for typing events and broadcast to everyone else
    socket.on('typing', (name) => {
        socket.broadcast.emit('typing', name);
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing');
    });

    // 5. Disconnection
    socket.on('disconnect', () => {
        io.emit('user count', io.engine.clientsCount);
        console.log(`Connection lost. Active Nodes: ${io.engine.clientsCount}`);
    });
});

// --- Server Initialization ---
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`--- BACKROOMS PROTOCOL ACTIVE ---`);
    console.log(`Listening on Port: ${PORT}`);
});