// 1. Import required tools
const express = require('express'); // Express makes building web servers easier
const app = express(); // Create our app instance
const http = require('http').Server(app); // Wrap Express inside a standard HTTP server
const io = require('socket.io')(http); // Attach Socket.io to our HTTP server for real-time communication
const path = require('path'); // A built-in Node tool to safely connect file paths

// 2. Serve the Chat Interface
// When someone visits your website's main URL ('/'), send them your HTML file
app.get('/', (req, res) => {
    // Note: Updated this to match your actual file name!
    const filePath = path.join(__dirname, 'BACKROOMSv!.html');
    
    // Send the file, and log an error to the server console if it fails to load
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("Error loading the Backrooms interface:", err);
            res.status(500).send("Transmission failed. File not found.");
        }
    });
});

// 3. Handle Real-Time Connections
// This block listens for new users connecting via Socket.io
io.on('connection', (socket) => {
    // A unique ID is assigned to every user who connects
    console.log(`[SYS] A user linked to the Backrooms... (ID: ${socket.id})`);

    // Listen for incoming messages labeled 'chat message' from this specific user
    socket.on('chat message', (data) => {
        // Broadcast the received data to EVERYONE currently connected
        io.emit('chat message', data); 
    });

    // Listen for when this specific user closes their browser or loses internet
    socket.on('disconnect', () => {
        console.log(`[SYS] Connection lost... (ID: ${socket.id})`);
    });
});

// 4. Start the Server
// Use the port assigned by your host (like Render), or default to 3000 on your computer
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`=================================`);
    console.log(` Server active on port ${PORT}`);
    console.log(` Awaiting transmissions...`);
    console.log(`=================================`);
});