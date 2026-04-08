const express = require('express');
const app = express();
const http = require('http').Server(app);
const path = require('path');

const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 
});

let messageHistory = []; 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    io.emit('user count', io.engine.clientsCount);
    console.log(`User connected. Total: ${io.engine.clientsCount}`);
    
    socket.emit('load history', messageHistory);

    socket.on('chat message', (data) => {
        if (data.text) {
            data.text = data.text.replace(/<[^>]*>?/gm, ''); 
        }

        messageHistory.push(data);
        if (messageHistory.length > 5) messageHistory.shift();
        
        io.emit('chat message', data); 
    });

    // --- TYPING INDICATOR LOGIC ADDED HERE ---
    socket.on('typing', (name) => {
        socket.broadcast.emit('typing', name); // Sends to everyone EXCEPT the person typing
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing');
    });

    socket.on('disconnect', () => {
        io.emit('user count', io.engine.clientsCount);
        console.log(`User disconnected. Total: ${io.engine.clientsCount}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server active on port ${PORT}`);
});