const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7, // 10MB
  pingTimeout: 60000,
  pingInterval: 25000,
});

// In-memory message buffer (only while users are online)
const messageBuffer = new Map(); // userId -> array of pending messages
const MAX_BUFFER_SIZE = 100; // Maximum messages to store per user
const MESSAGE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('../client'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp');

// User Model
const User = require('./models/User');
const authMiddleware = require('./middleware/auth');

// Generate unique 6-digit ID
function generateUniqueId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Routes

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate unique 6-digit ID
    let userId;
    let isUnique = false;
    while (!isUnique) {
      userId = generateUniqueId();
      const existingId = await User.findOne({ userId });
      if (!existingId) isUnique = true;
    }

    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      username,
      userId
    });

    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      userId,
      username
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Update online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      userId: user.userId,
      username: user.username
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Search user by ID
app.get('/api/user/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId })
      .select('-password -email');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Function to add message to buffer
function addToMessageBuffer(targetUserId, message) {
  if (!messageBuffer.has(targetUserId)) {
    messageBuffer.set(targetUserId, []);
  }
  
  const userBuffer = messageBuffer.get(targetUserId);
  
  // Add message with timestamp
  userBuffer.push({
    ...message,
    timestamp: new Date(),
    id: Date.now() + Math.random() // Simple unique ID
  });
  
  // Limit buffer size
  if (userBuffer.length > MAX_BUFFER_SIZE) {
    userBuffer.shift(); // Remove oldest message
  }
  
  // Clean old messages
  const now = Date.now();
  const filtered = userBuffer.filter(msg => 
    (now - new Date(msg.timestamp).getTime()) < MESSAGE_EXPIRY
  );
  messageBuffer.set(targetUserId, filtered);
}

// Function to get and clear pending messages
function getPendingMessages(userId, fromUserId = null) {
  if (!messageBuffer.has(userId)) {
    return [];
  }
  
  const userBuffer = messageBuffer.get(userId);
  
  if (fromUserId) {
    // Get messages from specific user
    const messages = userBuffer.filter(msg => msg.fromUserId === fromUserId);
    // Remove these messages from buffer
    const remaining = userBuffer.filter(msg => msg.fromUserId !== fromUserId);
    messageBuffer.set(userId, remaining);
    return messages;
  } else {
    // Get all messages
    const messages = [...userBuffer];
    messageBuffer.set(userId, []); // Clear buffer
    return messages;
  }
}

// Socket.IO for real-time chat
const activeUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('New client connected');

  // User joins with their ID
  socket.on('join', async (data) => {
    const { userId, username } = data;
    activeUsers.set(socket.id, { userId, username });
    userSockets.set(userId, socket.id);
    
    socket.userId = userId;
    
    // Update user online status in database
    try {
      await User.findOneAndUpdate(
        { userId: userId },
        { isOnline: true, lastSeen: new Date() }
      );
    } catch (error) {
      console.error('Error updating online status:', error);
    }
    
    console.log(`User ${username} (${userId}) joined`);
    
    // Notify all users that this user is online
    socket.broadcast.emit('user-online', { userId, username });

    // Send any pending messages
    const pendingMessages = getPendingMessages(userId);
    if (pendingMessages.length > 0) {
      // Group messages by sender
      const messagesBySender = {};
      pendingMessages.forEach(msg => {
        if (!messagesBySender[msg.fromUserId]) {
          messagesBySender[msg.fromUserId] = [];
        }
        messagesBySender[msg.fromUserId].push(msg);
      });
      
      // Send messages grouped by sender
      Object.keys(messagesBySender).forEach(senderId => {
        socket.emit('pending-messages', {
          fromUserId: senderId,
          messages: messagesBySender[senderId]
        });
      });
    }
  });

  // Request pending messages
  socket.on('request-pending-messages', (data) => {
    const { userId } = data;
    const pendingMessages = getPendingMessages(userId);
    
    if (pendingMessages.length > 0) {
      // Group messages by sender
      const messagesBySender = {};
      pendingMessages.forEach(msg => {
        if (!messagesBySender[msg.fromUserId]) {
          messagesBySender[msg.fromUserId] = [];
        }
        messagesBySender[msg.fromUserId].push(msg);
      });
      
      // Send messages grouped by sender
      Object.keys(messagesBySender).forEach(senderId => {
        socket.emit('pending-messages', {
          fromUserId: senderId,
          messages: messagesBySender[senderId]
        });
      });
    }
  });

  // Get pending messages for specific chat
  socket.on('get-pending-messages', (data) => {
    const { fromUserId, targetUserId } = data;
    const pendingMessages = getPendingMessages(fromUserId, targetUserId);
    
    if (pendingMessages.length > 0) {
      socket.emit('pending-messages', {
        fromUserId: targetUserId,
        messages: pendingMessages
      });
    }
  });

  // Handle contact added notification
  socket.on('contact-added', (data) => {
    const { targetUserId, addedBy } = data;
    const targetSocketId = userSockets.get(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('contact-added', {
        addedBy
      });
    }
  });

  // Handle key exchange for E2E encryption
  socket.on('key-exchange', (data) => {
    const { targetUserId, publicKey, type } = data;
    const targetSocketId = userSockets.get(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('key-exchange', {
        fromUserId: socket.userId,
        publicKey,
        type
      });
    }
  });

  // Update the encrypted-message handler to prevent duplicate buffering
socket.on('encrypted-message', (data) => {
    const { targetUserId, encryptedMessage, iv, senderInfo, messageId } = data;
    const targetSocketId = userSockets.get(targetUserId);
    
    const messageData = {
        id: messageId || `${Date.now()}-${Math.random()}`,
        fromUserId: socket.userId,
        encryptedMessage,
        iv,
        senderInfo,
        timestamp: new Date()
    };
    
    if (targetSocketId) {
        // User is online, send directly
        io.to(targetSocketId).emit('receive-message', messageData);
        // Don't buffer if message was delivered directly
    } else {
        // User is offline or not connected, store in buffer
        addToMessageBuffer(targetUserId, messageData);
    }
});

  // Handle typing indicator
  socket.on('typing', (data) => {
    const targetSocketId = userSockets.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('user-typing', {
        userId: socket.userId,
        isTyping: data.isTyping
      });
    }
  });

  // Handle encrypted image sending
  socket.on('encrypted-image', (data) => {
      const { targetUserId, imageData, messageId, senderInfo } = data;
      const targetSocketId = userSockets.get(targetUserId);
      
      const imageMessage = {
          id: messageId || `${Date.now()}-${Math.random()}`,
          fromUserId: socket.userId,
          imageData: imageData,
          senderInfo: senderInfo,
          timestamp: new Date()
      };
      
      if (targetSocketId) {
          // User is online, send directly
          io.to(targetSocketId).emit('receive-image', imageMessage);
      } else {
          // User is offline, buffer the message
          // Note: For production, consider not buffering images or using cloud storage
          console.log(`User ${targetUserId} is offline. Image not buffered.`);
          // Optionally: addToMessageBuffer(targetUserId, { ...imageMessage, type: 'image' });
      }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      userSockets.delete(user.userId);
      activeUsers.delete(socket.id);
      
      // Update user offline status in database
      try {
        await User.findOneAndUpdate(
          { userId: user.userId },
          { isOnline: false, lastSeen: new Date() }
        );
      } catch (error) {
        console.error('Error updating offline status:', error);
      }
      
      console.log(`User ${user.username} disconnected`);
      
      // Notify all users that this user is offline
      socket.broadcast.emit('user-offline', { 
        userId: user.userId,
        username: user.username 
      });
    }
  });
});

// Clean up old messages periodically (every hour)
setInterval(() => {
  const now = Date.now();
  messageBuffer.forEach((messages, userId) => {
    const filtered = messages.filter(msg => 
      (now - new Date(msg.timestamp).getTime()) < MESSAGE_EXPIRY
    );
    if (filtered.length !== messages.length) {
      messageBuffer.set(userId, filtered);
    }
    // Remove empty buffers
    if (filtered.length === 0) {
      messageBuffer.delete(userId);
    }
  });
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});