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

// Socket.IO configuration with production settings
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'],
  maxHttpBufferSize: 1e6, // 1MB for socket messages
  pingTimeout: 60000,
  pingInterval: 25000,
  allowUpgrades: true,
  upgradeTimeout: 30000,
  perMessageDeflate: {
    threshold: 1024 // Compress data over 1KB
  }
});

// In-memory message buffer (only while users are online)
const messageBuffer = new Map(); // userId -> array of pending messages
const MAX_BUFFER_SIZE = 100; // Maximum messages to store per user
const MESSAGE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Storage for images and chunks
const imageStorage = new Map();
const chunkedUploads = new Map();

// Active users and socket mapping
const activeUsers = new Map();
const userSockets = new Map();

// Middleware - IMPORTANT: Set limits BEFORE routes
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('../client'));

// MongoDB connection with error handling
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Model
const User = require('./models/User');
const authMiddleware = require('./middleware/auth');

// Helper Functions
function generateUniqueId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to get user socket
function getUserSocket(userId) {
  return userSockets.get(userId);
}

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
    id: message.id || `${Date.now()}-${Math.random()}`
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

// ============ API ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Validation
    if (!email || !password || !username) {
      return res.status(400).json({ message: 'All fields are required' });
    }

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
      { id: user._id, email: user.email, userId: user.userId },
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
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

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
      { id: user._id, email: user.email, userId: user.userId },
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
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Logout
app.post('/api/logout', authMiddleware, async (req, res) => {
  try {
    // Update user offline status
    await User.findByIdAndUpdate(
      req.userId,
      { 
        isOnline: false, 
        lastSeen: new Date() 
      }
    );
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
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
    console.error('User search error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ============ IMAGE HANDLING ROUTES ============

// Single image upload endpoint
app.post('/api/image/upload', authMiddleware, (req, res) => {
  try {
    const { messageId, targetUserId, encryptedData, iv, fileName, fileType, fileSize, originalSize } = req.body;
    
    // Validation
    if (!messageId || !targetUserId || !encryptedData || !iv) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check size limit (50MB after encryption/encoding)
    if (encryptedData.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large' });
    }
    
    // Store image
    imageStorage.set(messageId, {
      messageId,
      targetUserId,
      encryptedData,
      iv,
      fileName,
      fileType,
      fileSize,
      originalSize,
      senderId: req.userId,
      timestamp: new Date()
    });
    
    console.log(`Image stored: ${messageId}, size: ${(encryptedData.length / 1024 / 1024).toFixed(2)}MB`);
    
    res.json({ success: true, messageId });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Metadata endpoint for chunked uploads
app.post('/api/image/metadata', authMiddleware, (req, res) => {
  try {
    const { messageId, targetUserId, fileName, fileType, fileSize, totalChunks, iv } = req.body;
    
    // Validation
    if (!messageId || !targetUserId || !totalChunks) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if upload already exists
    if (chunkedUploads.has(messageId)) {
      return res.status(409).json({ error: 'Upload already in progress' });
    }
    
    chunkedUploads.set(messageId, {
      messageId,
      targetUserId,
      fileName,
      fileType,
      fileSize,
      totalChunks,
      iv,
      chunks: new Array(totalChunks),
      receivedChunks: 0,
      senderId: req.userId,
      timestamp: new Date()
    });
    
    console.log(`Chunked upload started: ${messageId}, chunks: ${totalChunks}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({ error: 'Failed to process metadata' });
  }
});

// Chunk upload endpoint
app.post('/api/image/chunk', authMiddleware, (req, res) => {
  try {
    const { messageId, chunkIndex, chunkData, isLastChunk } = req.body;
    
    const upload = chunkedUploads.get(messageId);
    if (!upload) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    
    // Validate chunk index
    if (chunkIndex >= upload.totalChunks || chunkIndex < 0) {
      return res.status(400).json({ error: 'Invalid chunk index' });
    }
    
    // Store chunk
    upload.chunks[chunkIndex] = chunkData;
    upload.receivedChunks++;
    
    console.log(`Chunk received: ${messageId} - ${upload.receivedChunks}/${upload.totalChunks}`);
    
    // Check if all chunks received
    if (isLastChunk && upload.receivedChunks === upload.totalChunks) {
      // Verify all chunks are present
      const missingChunks = upload.chunks.findIndex(chunk => !chunk);
      if (missingChunks !== -1) {
        return res.status(400).json({ error: `Missing chunk ${missingChunks}` });
      }
      
      // Reconstruct complete data
      const completeData = upload.chunks.join('');
      
      console.log(`Image reconstructed: ${messageId}, size: ${(completeData.length / 1024 / 1024).toFixed(2)}MB`);
      
      // Store complete image
      imageStorage.set(messageId, {
        messageId,
        targetUserId: upload.targetUserId,
        encryptedData: completeData,
        iv: upload.iv,
        fileName: upload.fileName,
        fileType: upload.fileType,
        fileSize: upload.fileSize,
        senderId: upload.senderId,
        timestamp: upload.timestamp
      });
      
      // Clean up chunks
      chunkedUploads.delete(messageId);
      
      // Notify target user via socket if online
      const targetSocketId = getUserSocket(upload.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('image-ready', {
          messageId,
          fromUserId: upload.senderId
        });
      }
    }
    
    res.json({ success: true, received: upload.receivedChunks, total: upload.totalChunks });
  } catch (error) {
    console.error('Chunk error:', error);
    res.status(500).json({ error: 'Failed to process chunk' });
  }
});

// Get image endpoint
app.get('/api/image/:messageId', authMiddleware, (req, res) => {
  try {
    const { messageId } = req.params;
    const imageData = imageStorage.get(messageId);
    
    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Optional: Verify user has permission to access this image
    // const userId = req.userId;
    // if (imageData.senderId !== userId && imageData.targetUserId !== userId) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }
    
    res.json(imageData);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Failed to retrieve image' });
  }
});

// ============ SOCKET.IO HANDLERS ============

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User joins with their ID
  socket.on('join', async (data) => {
    const { userId, username } = data;
    
    if (!userId || !username) {
      console.error('Invalid join data');
      return;
    }
    
    activeUsers.set(socket.id, { userId, username });
    userSockets.set(userId, socket.id);
    
    socket.userId = userId;
    socket.username = username;
    
    // Join user's personal room for targeted messages
    socket.join(userId);
    
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
      
      console.log(`Sent ${pendingMessages.length} pending messages to ${username}`);
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

  // Handle contact added notification
  socket.on('contact-added', (data) => {
    const { targetUserId, addedBy } = data;
    const targetSocketId = getUserSocket(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('contact-added', { addedBy });
      console.log(`Contact notification sent to ${targetUserId}`);
    }
  });

  // Handle key exchange for E2E encryption (Required for client-side encryption)
  socket.on('key-exchange', (data) => {
    const { targetUserId, publicKey, type } = data;
    const targetSocketId = getUserSocket(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('key-exchange', {
        fromUserId: socket.userId,
        publicKey,
        type
      });
      console.log(`Key exchange (${type}) from ${socket.userId} to ${targetUserId}`);
    }
  });

  // Handle encrypted messages
  socket.on('encrypted-message', (data) => {
    const { targetUserId, encryptedMessage, iv, senderInfo, messageId } = data;
    const targetSocketId = getUserSocket(targetUserId);
    
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
      console.log(`Message sent from ${socket.userId} to ${targetUserId}`);
    } else {
      // User is offline, store in buffer
      addToMessageBuffer(targetUserId, messageData);
      console.log(`Message buffered for offline user ${targetUserId}`);
    }
  });

  // Handle typing indicator
  socket.on('typing', (data) => {
    const targetSocketId = getUserSocket(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('user-typing', {
        userId: socket.userId,
        isTyping: data.isTyping
      });
    }
  });

  // Handle image notifications
  socket.on('image-notification', (data) => {
    const { targetUserId, messageId, senderInfo } = data;
    const targetSocketId = getUserSocket(targetUserId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('image-notification', {
        messageId,
        fromUserId: senderInfo.userId,
        senderInfo
      });
      console.log(`Image notification sent to ${targetUserId}`);
    } else {
      // Optionally store notification for offline user
      console.log(`User ${targetUserId} is offline, image notification not sent`);
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
      
      console.log(`User ${user.username} (${user.userId}) disconnected`);
      
      // Notify all users that this user is offline
      socket.broadcast.emit('user-offline', { 
        userId: user.userId,
        username: user.username 
      });
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// ============ CLEANUP TASKS ============

// Clean up old messages periodically (every hour)
setInterval(() => {
  const now = Date.now();
  let cleanedMessages = 0;
  
  messageBuffer.forEach((messages, userId) => {
    const filtered = messages.filter(msg => 
      (now - new Date(msg.timestamp).getTime()) < MESSAGE_EXPIRY
    );
    if (filtered.length !== messages.length) {
      cleanedMessages += messages.length - filtered.length;
      messageBuffer.set(userId, filtered);
    }
    // Remove empty buffers
    if (filtered.length === 0) {
      messageBuffer.delete(userId);
    }
  });
  
  if (cleanedMessages > 0) {
    console.log(`Cleaned ${cleanedMessages} old messages from buffer`);
  }
}, 60 * 60 * 1000); // Run every hour

// Clean old image data periodically (every 30 minutes)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  let cleanedImages = 0;
  let cleanedChunks = 0;
  
  // Clean image storage
  for (const [id, data] of imageStorage.entries()) {
    if (new Date(data.timestamp).getTime() < oneHourAgo) {
      imageStorage.delete(id);
      cleanedImages++;
    }
  }
  
  // Clean incomplete chunked uploads
  for (const [id, data] of chunkedUploads.entries()) {
    if (new Date(data.timestamp).getTime() < oneHourAgo) {
      chunkedUploads.delete(id);
      cleanedChunks++;
    }
  }
  
  if (cleanedImages > 0 || cleanedChunks > 0) {
    console.log(`Cleaned ${cleanedImages} old images and ${cleanedChunks} incomplete uploads`);
  }
}, 30 * 60 * 1000); // Every 30 minutes

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    mongoose.connection.close();
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
