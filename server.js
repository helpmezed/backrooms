const express = require('express');
const app = express();
const http = require('http').Server(app);
const path = require('path');

// Initialize Socket.io with a 10MB upload limit for images/gifs
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 
});

// This array stores the last 5 messages sent so the chat isn't empty when you join
let messageHistory = []; 

// Serve your main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    // 1. Tell everyone the new total user count immediately
    io.emit('user count', io.engine.clientsCount);
    console.log(`User connected. Total: ${io.engine.clientsCount}`);
    
    // 2. Send the last 5 messages to the new user so they see the context
    socket.emit('load history', messageHistory);

    // 3. Listen for new messages
    socket.on('chat message', (data) => {
        // Basic Sanitization: Removes any sneaky HTML tags someone might try to type
        if (data.text) {
            data.text = data.text.replace(/<[^>]*>?/gm, ''); 
        }

        // Add the new message to our history
        messageHistory.push(data);
        
        // If we have more than 5 messages, remove the oldest one
        if (messageHistory.length > 5) {
            messageHistory.shift();
        }
        
        // Send the message to everyone online
        io.emit('chat message', data); 
    });

    // 4. Handle Disconnections
    socket.on('disconnect', () => {
        // Update everyone on the new user count when someone leaves
        io.emit('user count', io.engine.clientsCount);
        console.log(`User disconnected. Total: ${io.engine.clientsCount}`);
    });
});

// Set the port for Render (or localhost 3000)
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server active on port ${PORT}`);
});