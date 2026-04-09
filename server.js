const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors'); // FIXED: Added missing import

const app = express();
const server = http.createServer(app);

// FIXED: Proper CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST"]
}));

// FIXED: Increased buffer size with validation
const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB
    pingTimeout: 60000,     // FIXED: Add heartbeat timeout
    pingInterval: 25000,    // FIXED: Add ping interval
    cors: {
        origin: process.env.ALLOWED_ORIGIN || "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting store (simple in-memory, use Redis in production)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const MAX_MESSAGES_PER_WINDOW = 10;

function checkRateLimit(socketId) {
    const now = Date.now();
    const userLimit = rateLimits.get(socketId);
    
    if (!userLimit || now > userLimit.resetTime) {
        rateLimits.set(socketId, {
            count: 1,
            resetTime: now + RATE_LIMIT_WINDOW
        });
        return true;
    }
    
    if (userLimit.count >= MAX_MESSAGES_PER_WINDOW) {
        return false;
    }
    
    userLimit.count++;
    return true;
}

// THE ENTITY MAP: Stores active users indexed by their Socket ID
const activeUsers = new Map();

// FIXED: Message history with TTL and max size
const messageHistory = [];
const MAX_HISTORY = 100;
const HISTORY_TTL = 24 * 60 * 60 * 1000; // 24 hours

function addToHistory(msg) {
    const enriched = {
        ...msg,
        _timestamp: Date.now() // Internal timestamp for TTL
    };
    messageHistory.push(enriched);
    
    // FIXED: Enforce max size
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }
    
    // FIXED: Clean old messages periodically
    const cutoff = Date.now() - HISTORY_TTL;
    while (messageHistory.length > 0 && messageHistory[0]._timestamp < cutoff) {
        messageHistory.shift();
    }
}

// FIXED: Sanitize user input with stricter validation
function sanitizeUser(userData, socketId) {
    if (!userData || typeof userData !== 'object') {
        return null;
    }
    
    const name = String(userData.name || 'Unknown')
        .slice(0, 20)
        .replace(/[<>\"'&]/g, '') // FIXED: Remove more dangerous chars
        .trim();
    
    if (name.length < 2) {
        return null;
    }
    
    // FIXED: Validate avatar URL (data URI or http only)
    let avatarUrl = null;
    if (userData.avatarUrl) {
        const url = String(userData.avatarUrl);
        if (url.startsWith('data:image/') || url.startsWith('http://') || url.startsWith('https://')) {
            avatarUrl = url.slice(0, 10000); // Limit size
        }
    }
    
    return {
        id: socketId,
        name: name,
        avatarUrl: avatarUrl,
        joinedAt: Date.now()
    };
}

// FIXED: Validate message structure
function validateMessage(msgData, senderUser) {
    if (!msgData || typeof msgData !== 'object') {
        return null;
    }
    
    // Validate text
    const text = String(msgData.text || '').slice(0, 2000);
    
    // Validate files
    const files = [];
    if (Array.isArray(msgData.files)) {
        for (const file of msgData.files.slice(0, 5)) {
            if (!file || typeof file !== 'object') continue;
            
            // FIXED: Check file size in base64 (rough estimate)
            const dataSize = file.data ? file.data.length : 0;
            if (dataSize > 1.4e8) { // ~100MB in base64
                continue;
            }
            
            files.push({
                type: String(file.type || 'application/octet-stream').slice(0, 50),
                name: String(file.name || 'unknown').slice(0, 100),
                data: String(file.data || '').slice(0, 1.4e8) // Hard limit
            });
        }
    }
    
    return {
        id: msgData.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        user: senderUser,
        text: text,
        files: files,
        timestamp: String(msgData.timestamp || new Date().toLocaleTimeString()).slice(0, 20),
        isAlert: !!msgData.isAlert,
        replyTo: msgData.replyTo ? {
            id: String(msgData.replyTo.id || '').slice(0, 50),
            user: msgData.replyTo.user ? {
                name: String(msgData.replyTo.user.name || 'Unknown').slice(0, 20)
            } : { name: 'Unknown' },
            text: String(msgData.replyTo.text || '').slice(0, 100)
        } : null
    };
}

io.on('connection', (socket) => {
    console.log(`◇ New connection established: ${socket.id} from ${socket.handshake.address}`);

    // FIXED: Send current user count immediately
    socket.emit('user count', activeUsers.size);
    socket.emit('load history', messageHistory.map(m => {
        // Strip internal fields
        const { _timestamp, ...clean } = m;
        return clean;
    }));

    // FIXED: User joined with validation and rate limiting
    socket.on('user joined', (userData) => {
        if (!checkRateLimit(socket.id)) {
            socket.emit('error', { message: 'Rate limit exceeded' });
            return;
        }
        
        const sanitized = sanitizeUser(userData, socket.id);
        if (!sanitized) {
            socket.emit('error', { message: 'Invalid user data' });
            return;
        }
        
        // FIXED: Remove any existing entry for this socket (reconnect protection)
        activeUsers.set(socket.id, sanitized);
        
        console.log(`◉ Entity Authenticated: ${sanitized.name} (${socket.id})`);
        
        // Broadcast updates
        io.emit('user list', Array.from(activeUsers.values()));
        io.emit('user count', activeUsers.size);
        socket.broadcast.emit('user joined', sanitized);
    });

    // FIXED: Messaging with rate limiting and validation
    socket.on('chat message', (msgData) => {
        if (!checkRateLimit(socket.id)) {
            socket.emit('error', { message: 'Rate limit exceeded. Slow down.' });
            return;
        }
        
        const sender = activeUsers.get(socket.id);
        if (!sender) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const validated = validateMessage(msgData, sender);
        if (!validated) {
            socket.emit('error', { message: 'Invalid message format' });
            return;
        }
        
        // FIXED: Don't log empty messages
        if (!validated.text && validated.files.length === 0) {
            return;
        }
        
        addToHistory(validated);
        
        // Broadcast to others (sender has optimistic render)
        socket.broadcast.emit('chat message', validated);
        
        // FIXED: Acknowledge receipt
        socket.emit('message received', { id: validated.id });
    });

    // FIXED: Typing with validation
    socket.on('typing', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;
        
        socket.broadcast.emit('typing', {
            isTyping: !!data?.isTyping,
            user: {
                id: user.id,
                name: user.name
            }
        });
    });

    // FIXED: Graceful disconnect cleanup
    socket.on('disconnect', (reason) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            console.log(`◌ Signal Lost: ${user.name} (${socket.id}) - ${reason}`);
            activeUsers.delete(socket.id);
            rateLimits.delete(socket.id); // Clean up rate limit data
            
            io.emit('user list', Array.from(activeUsers.values()));
            io.emit('user count', activeUsers.size);
            io.emit('user left', user);
        } else {
            console.log(`◌ Signal Lost: Anonymous (${socket.id}) - ${reason}`);
        }
    });

    // FIXED: Error handling
    socket.on('error', (err) => {
        console.error(`⚠ Socket error (${socket.id}):`, err.message);
    });
    
    // FIXED: Handle specific errors
    socket.on('connect_error', (err) => {
        console.error(`⚠ Connection error (${socket.id}):`, err.message);
    });
});

// FIXED: Secure health check (less info leakage)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online', 
        version: '1.0.0',
        timestamp: new Date().toISOString()
        // Removed: exact user count, uptime (potential info leaks)
    });
});

// FIXED: Add a status endpoint that requires auth for detailed info
app.get('/status', (req, res) => {
    // Simple auth check (use proper auth in production)
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({
        entities: activeUsers.size,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        historySize: messageHistory.length
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║     BACKROOM TERMINAL ONLINE       ║
    ╠════════════════════════════════════╣
    ║  Access Point: http://localhost:${PORT}  ║
    ║  Data Limit: 100MB per packet      ║
    ║  Protocol: WebSocket v4            ║
    ║  CORS: ${process.env.ALLOWED_ORIGIN || 'enabled for all'}      ║
    ╚════════════════════════════════════╝
    `);
});

// FIXED: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});