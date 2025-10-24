// Define the server URL
// const SERVER_URL = 'http://localhost:3000';
const SERVER_URL = 'https://test-secure-chat-app.onrender.com';
const API_URL = `${SERVER_URL}/api`;
const IS_PRODUCTION = SERVER_URL.includes('onrender.com') || !SERVER_URL.includes('localhost');

// Initialize Socket.IO with production-ready config
let socket;

try {
    socket = io(SERVER_URL, {
        transports: IS_PRODUCTION ? ['polling', 'websocket'] : ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        maxHttpBufferSize: 1e6, // 1MB for socket messages only
        pingTimeout: 60000,
        pingInterval: 25000,
        upgrade: true,
        rememberUpgrade: true
    });
    
    socket.on('connect', () => {
        console.log('Connected to server via:', socket.io.engine.transport.name);
        if (localStorage.getItem('userId')) {
            socket.emit('join', {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            });
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        if (reason === 'io server disconnect') {
            socket.connect();
        }
    });
    
} catch (error) {
    console.error('Failed to initialize Socket.IO:', error);
    alert('Failed to initialize chat connection.');
}

const encryption = new E2EEncryption();
let currentChatUser = null;
let contacts = new Map();
let typingTimeout;
let onlineUsers = new Set();
let messageBuffer = new Map();
let processedMessages = new Set();

// Image handling utilities
const imageChunks = new Map();
const CHUNK_SIZE = 256 * 1024; // 256KB chunks for production
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB max

// Initialize encryption
async function initEncryption() {
    await encryption.generateKeyPair();
}

// Check authentication
if (!localStorage.getItem('token')) {
    window.location.href = '/login.html';
}

// Display user info
document.getElementById('username').textContent = localStorage.getItem('username');
document.getElementById('userId').textContent = localStorage.getItem('userId');
document.getElementById('chatWith').textContent = '';

// Show toast notification
function showOfflineToast(message) {
    const toast = document.getElementById('offlineToast');
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Check if user is online
function isUserOnline(userId) {
    return onlineUsers.has(userId);
}

// Update empty state in contacts list
function updateContactsEmptyState() {
    const contactsList = document.getElementById('contactsList');
    const hasContacts = contacts.size > 0;
    
    if (!hasContacts) {
        contactsList.innerHTML = `
            <div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p>No contacts yet</p>
                <small>Add contacts using their 6-digit ID</small>
            </div>
        `;
    } else {
        const emptyState = contactsList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
    }
}

// Generate unique message ID
function generateMessageId(message, timestamp, userId) {
    return `${userId}-${timestamp}-${message.substring(0, 10)}`;
}

// Store message in local buffer
function storeMessageInBuffer(userId, message, type, timestamp = new Date(), messageId = null) {
    if (!messageBuffer.has(userId)) {
        messageBuffer.set(userId, []);
    }
    
    const id = messageId || generateMessageId(message, timestamp.getTime(), userId);
    const existingMessages = messageBuffer.get(userId);
    const exists = existingMessages.some(msg => msg.id === id);
    
    if (!exists) {
        messageBuffer.get(userId).push({
            id,
            message,
            type,
            timestamp,
            fromUserId: type === 'received' ? userId : localStorage.getItem('userId')
        });
    }
}

// Get buffered messages for a user
function getBufferedMessages(userId) {
    return messageBuffer.get(userId) || [];
}

// Update message controls based on user status
function updateMessageControls() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (!currentChatUser) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        messageInput.placeholder = 'Select a contact to start chatting';
        return;
    }
    
    const isOnline = isUserOnline(currentChatUser);
    const user = contacts.get(currentChatUser);
    
    if (!isOnline) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        messageInput.placeholder = `${user?.username || 'User'} is offline`;
        sendBtn.style.opacity = '0.5';
    } else {
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.placeholder = 'Type a message...(Shift+Enter for new line)';
        sendBtn.style.opacity = '1';
    }
}

// Copy ID button
document.getElementById('copyIdBtn').addEventListener('click', () => {
    const userId = localStorage.getItem('userId');
    navigator.clipboard.writeText(userId);
    document.getElementById('copyIdBtn').textContent = 'Copied!';
    setTimeout(() => {
        document.getElementById('copyIdBtn').textContent = 'Copy ID';
    }, 2000);
});

// Search and connect with user
document.getElementById('searchBtn').addEventListener('click', async () => {
    const searchId = document.getElementById('searchInput').value.trim();
    
    if (searchId.length !== 6) {
        showOfflineToast('Please enter a valid 6-digit ID');
        return;
    }

    if (searchId === localStorage.getItem('userId')) {
        showOfflineToast('You cannot add yourself as a contact');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/user/${searchId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            const user = await response.json();
            contacts.set(user.userId, user);

            if (user.isOnline) {
                onlineUsers.add(user.userId);
            }

            updateContactsEmptyState();
            displayContact(user);

            socket.emit('contact-added', {
                targetUserId: user.userId,
                addedBy: {
                    userId: localStorage.getItem('userId'),
                    username: localStorage.getItem('username')
                }
            });

            await initiateKeyExchange(user.userId);
            
            document.getElementById('searchInput').value = '';
            showOfflineToast(`Successfully connected with ${user.username}`);
        } else {
            const error = await response.json();
            showOfflineToast(error.message || 'User not found');
        }
    } catch (error) {
        showOfflineToast('Error connecting to user. Please try again.');
    }
});

// Handle when someone adds you as contact
socket.on('contact-added', async (data) => {
    const { addedBy } = data;
    
    if (!contacts.has(addedBy.userId)) {
        try {
            const response = await fetch(`${API_URL}/user/${addedBy.userId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                contacts.set(user.userId, user);
                onlineUsers.add(user.userId);
                updateContactsEmptyState();
                displayContact(user);
                showNotification(user.username, `${user.username} added you as a contact`);
            }
        } catch (error) {
            console.error('Error fetching contact:', error);
        }
    }
});

// Display contact in sidebar
function displayContact(user) {
    const contactsList = document.getElementById('contactsList');
    const emptyState = contactsList.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    let contactDiv = document.getElementById(`contact-${user.userId}`);
    
    if (!contactDiv) {
        contactDiv = document.createElement('div');
        contactDiv.className = 'contact-item';
        contactDiv.id = `contact-${user.userId}`;
        contactsList.appendChild(contactDiv);
    }

    const isOnline = onlineUsers.has(user.userId);
    contactDiv.innerHTML = `
        <div class="contact-info">
            <div class="contact-name">${user.username}</div>
            <small>ID: ${user.userId}</small>
        </div>
        <div class="contact-status">
            ${isOnline ? '<div class="online-indicator"></div>' : '<div class="offline-indicator"></div>'}
        </div>
    `;

    contactDiv.onclick = () => selectContact(user);
}

// Select contact for chat
function selectContact(user) {
    currentChatUser = user.userId;
    
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    document.getElementById(`contact-${user.userId}`).classList.add('active');

    const isOnline = onlineUsers.has(user.userId);
    document.getElementById('chatWith').innerHTML = `
        ${user.username} 
        <span class="status-badge ${isOnline ? 'online' : 'offline'}">
            ${isOnline ? '● Online' : '● Offline'}
        </span>
    `;

    updateMessageControls();
    document.getElementById('messagesContainer').innerHTML = '';

    const contactDiv = document.getElementById(`contact-${user.userId}`);
    if (contactDiv) {
        contactDiv.classList.remove('has-unread');
    }

    processedMessages.clear();
    
    const bufferedMessages = getBufferedMessages(user.userId);
    if (bufferedMessages.length > 0) {
        bufferedMessages.forEach(msg => {
            if (!processedMessages.has(msg.id)) {
                processedMessages.add(msg.id);
                displayMessage(msg.message, msg.type, msg.fromUserId, msg.timestamp);
            }
        });
    } else {
        document.getElementById('messagesContainer').innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
                <p>Start a conversation with ${user.username}</p>
            </div>
        `;
    }
}

// Handle pending messages from server
socket.on('pending-messages', async (data) => {
    const { messages, fromUserId } = data;
    
    for (const msgData of messages) {
        try {
            const messageId = `${msgData.id || Date.now()}-${fromUserId}`;
            
            if (processedMessages.has(messageId)) {
                continue;
            }
            
            const decryptedMessage = await encryption.decryptMessage(
                msgData.encryptedMessage,
                msgData.iv,
                fromUserId
            );
            
            storeMessageInBuffer(fromUserId, decryptedMessage, 'received', new Date(msgData.timestamp), messageId);
            
            if (currentChatUser === fromUserId) {
                processedMessages.add(messageId);
                displayMessage(decryptedMessage, 'received', fromUserId, new Date(msgData.timestamp));
            } else {
                const contactDiv = document.getElementById(`contact-${fromUserId}`);
                if (contactDiv && !contactDiv.classList.contains('has-unread')) {
                    contactDiv.classList.add('has-unread');
                }
            }
        } catch (error) {
            console.error('Error decrypting pending message:', error);
        }
    }
});

// Handle user online status
socket.on('user-online', (data) => {
    const { userId, username } = data;
    onlineUsers.add(userId);
    
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = true;
        displayContact(user);
        
        if (currentChatUser === userId) {
            document.getElementById('chatWith').innerHTML = `
                ${username} 
                <span class="status-badge online">● Online</span>
            `;
            updateMessageControls();
        }
    }
});

// Handle user offline status
socket.on('user-offline', (data) => {
    const { userId } = data;
    onlineUsers.delete(userId);
    
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = false;
        displayContact(user);
        
        if (currentChatUser === userId) {
            document.getElementById('chatWith').innerHTML = `
                ${user.username} 
                <span class="status-badge offline">● Offline</span>
            `;
            updateMessageControls();
        }
    }
});

// Key exchange for E2E encryption
async function initiateKeyExchange(targetUserId) {
    const publicKey = await encryption.exportPublicKey();
    const aesKey = await encryption.generateAESKey();
    
    socket.emit('key-exchange', {
        targetUserId,
        publicKey,
        type: 'public-key'
    });
    
    encryption.tempAESKey = aesKey;
}

// Handle key exchange
socket.on('key-exchange', async (data) => {
    if (data.type === 'public-key') {
        const publicKey = await encryption.importPublicKey(data.publicKey);
        const aesKey = await encryption.generateAESKey();
        encryption.setSharedSecret(data.fromUserId, aesKey);
        
        const encryptedAESKey = await encryption.encryptAESKey(aesKey, publicKey);
        
        socket.emit('key-exchange', {
            targetUserId: data.fromUserId,
            publicKey: encryptedAESKey,
            type: 'aes-key'
        });
    } else if (data.type === 'aes-key') {
        const aesKey = await encryption.decryptAESKey(data.publicKey);
        encryption.setSharedSecret(data.fromUserId, aesKey);
    }
});

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('input', handleTyping);

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message || !currentChatUser) return;
    
    if (!isUserOnline(currentChatUser)) {
        const user = contacts.get(currentChatUser);
        showOfflineToast(`${user?.username || 'User'} is offline. Message cannot be sent.`);
        return;
    }
    
    try {
        const { encrypted, iv } = await encryption.encryptMessage(message, currentChatUser);
        const timestamp = new Date();
        const messageId = generateMessageId(message, timestamp.getTime(), localStorage.getItem('userId'));
        
        socket.emit('encrypted-message', {
            targetUserId: currentChatUser,
            encryptedMessage: encrypted,
            iv: iv,
            messageId: messageId,
            senderInfo: {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            }
        });
        
        storeMessageInBuffer(currentChatUser, message, 'sent', timestamp, messageId);
        processedMessages.add(messageId);
        displayMessage(message, 'sent');
        
        if (window.resetTextareaHeight) {
            window.resetTextareaHeight();
        } else {
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showOfflineToast('Error sending message. Please try again.');
    }
}

// Receive message
socket.on('receive-message', async (data) => {
    try {
        const messageId = data.messageId || `${data.fromUserId}-${new Date(data.timestamp).getTime()}`;
        
        if (processedMessages.has(messageId)) {
            return;
        }
        
        if (!contacts.has(data.fromUserId)) {
            const response = await fetch(`${API_URL}/user/${data.fromUserId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                contacts.set(user.userId, user);
                onlineUsers.add(user.userId);
                updateContactsEmptyState();
                displayContact(user);
            }
        }
        
        const decryptedMessage = await encryption.decryptMessage(
            data.encryptedMessage,
            data.iv,
            data.fromUserId
        );
        
        processedMessages.add(messageId);
        storeMessageInBuffer(data.fromUserId, decryptedMessage, 'received', new Date(data.timestamp), messageId);
        
        if (currentChatUser === data.fromUserId) {
            displayMessage(decryptedMessage, 'received', data.fromUserId, new Date(data.timestamp));
        } else {
            const sender = contacts.get(data.fromUserId);
            showNotification(sender?.username || 'New Message', decryptedMessage);
            
            const contactDiv = document.getElementById(`contact-${data.fromUserId}`);
            if (contactDiv && !contactDiv.classList.contains('has-unread')) {
                contactDiv.classList.add('has-unread');
            }
        }
        
    } catch (error) {
        console.error('Error decrypting message:', error);
    }
});

// Display message in chat
function displayMessage(message, type, fromUserId = null, timestamp = new Date()) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const emptyMessage = messagesContainer.querySelector('div[style*="text-align: center"]');
    const noChatSelected = messagesContainer.querySelector('.no-chat-selected');
    if (emptyMessage) emptyMessage.remove();
    if (noChatSelected) noChatSelected.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let senderName = '';
    if (type === 'received' && fromUserId) {
        const sender = contacts.get(fromUserId);
        senderName = `<div class="message-sender">${sender?.username || 'Unknown'}</div>`;
    }
    
    messageDiv.innerHTML = `
        <div class="message-bubble">
            ${senderName}
            <div>${message}</div>
            <div class="message-time">${time}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Typing indicator
function handleTyping() {
    if (!currentChatUser || !isUserOnline(currentChatUser)) return;
    
    socket.emit('typing', {
        targetUserId: currentChatUser,
        isTyping: true
    });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', {
            targetUserId: currentChatUser,
            isTyping: false
        });
    }, 1000);
}

socket.on('user-typing', (data) => {
    const typingIndicator = document.getElementById('typingIndicator');
    if (data.isTyping && data.userId === currentChatUser) {
        const user = contacts.get(data.userId);
        typingIndicator.querySelector('span').textContent = user?.username || 'User';
        typingIndicator.style.display = 'block';
    } else {
        typingIndicator.style.display = 'none';
    }
});

// ====================
// IMAGE HANDLING - INDUSTRIAL LEVEL
// ====================

// Compress image with quality adjustment
async function compressImage(file, maxWidth = 1920, maxHeight = 1080, targetSizeMB = 1) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                let quality = 0.9;
                let width = img.width;
                let height = img.height;
                
                // Calculate new dimensions
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round(width * (maxHeight / height));
                        height = maxHeight;
                    }
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const tryCompress = (q) => {
                    return new Promise((resolveBlob) => {
                        canvas.toBlob((blob) => {
                            resolveBlob(blob);
                        }, 'image/jpeg', q);
                    });
                };
                
                const compress = async () => {
                    let blob = await tryCompress(quality);
                    const targetSize = targetSizeMB * 1024 * 1024;
                    
                    while (blob.size > targetSize && quality > 0.1) {
                        quality -= 0.1;
                        blob = await tryCompress(quality);
                    }
                    
                    console.log(`Compressed: ${(file.size/1024/1024).toFixed(2)}MB -> ${(blob.size/1024/1024).toFixed(2)}MB`);
                    
                    resolve(new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    }));
                };
                
                compress();
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
}

// Upload image via HTTP (production-ready)
async function uploadImageViaHTTP(file, targetUserId) {
    try {
        showOfflineToast('Processing image...');
        
        // Compress if large
        let fileToUpload = file;
        if (file.size > 1 * 1024 * 1024) {
            showOfflineToast('Compressing image...');
            fileToUpload = await compressImage(file, 1920, 1080, 0.8);
        }
        
        showOfflineToast('Encrypting image...');
        
        const arrayBuffer = await fileToUpload.arrayBuffer();
        const { encrypted, iv } = await encryption.encryptFile(arrayBuffer, targetUserId);
        
        const messageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Split into chunks if needed
        const chunks = [];
        const chunkSize = 500 * 1024; // 500KB chunks
        
        for (let i = 0; i < encrypted.length; i += chunkSize) {
            chunks.push(encrypted.slice(i, i + chunkSize));
        }
        
        if (chunks.length > 1) {
            // Upload in chunks
            showOfflineToast(`Uploading in ${chunks.length} parts...`);
            
            // Send metadata
            const metadataResponse = await fetch(`${API_URL}/image/metadata`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    messageId,
                    targetUserId,
                    fileName: fileToUpload.name,
                    fileType: fileToUpload.type,
                    fileSize: fileToUpload.size,
                    originalSize: file.size,
                    totalChunks: chunks.length,
                    iv
                })
            });
            
            if (!metadataResponse.ok) {
                throw new Error('Failed to send metadata');
            }
            
            // Upload chunks
            for (let i = 0; i < chunks.length; i++) {
                const chunkResponse = await fetch(`${API_URL}/image/chunk`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({
                        messageId,
                        chunkIndex: i,
                        chunkData: chunks[i],
                        isLastChunk: i === chunks.length - 1
                    })
                });
                
                if (!chunkResponse.ok) {
                    throw new Error(`Failed to upload chunk ${i + 1}`);
                }
                
                const progress = Math.round(((i + 1) / chunks.length) * 100);
                if (progress % 25 === 0) {
                    showOfflineToast(`Uploading: ${progress}%`);
                }
            }
        } else {
            // Single upload for small images
            showOfflineToast('Uploading image...');
            
            const response = await fetch(`${API_URL}/image/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    messageId,
                    targetUserId,
                    encryptedData: encrypted,
                    iv,
                    fileName: fileToUpload.name,
                    fileType: fileToUpload.type,
                    fileSize: fileToUpload.size,
                    originalSize: file.size
                })
            });
            
            if (!response.ok) {
                throw new Error('Upload failed');
            }
        }
        
        // Display locally
        displayImageMessage({
            messageId,
            encrypted,
            iv,
            fileName: fileToUpload.name,
            fileType: fileToUpload.type,
            fileSize: fileToUpload.size
        }, true);
        
        // Notify via socket
        socket.emit('image-notification', {
            targetUserId,
            messageId,
            senderInfo: {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            }
        });
        
        showOfflineToast('Image sent successfully!');
        
    } catch (error) {
        console.error('Error uploading image:', error);
        showOfflineToast('Failed to send image');
    }
}

// Handle image notification
socket.on('image-notification', async (data) => {
    try {
        const response = await fetch(`${API_URL}/image/${data.messageId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            const imageData = await response.json();
            
            if (data.fromUserId === currentChatUser) {
                displayImageMessage(imageData, false, data.senderInfo);
                
                // Decrypt and display
                const messageDiv = document.querySelector(`[data-message-id="${imageData.messageId}"]`);
                if (messageDiv) {
                    const img = messageDiv.querySelector('img');
                    if (img) {
                        const decryptedBuffer = await encryption.decryptFile(
                            imageData.encryptedData,
                            imageData.iv,
                            data.fromUserId
                        );
                        
                        const blob = new Blob([decryptedBuffer], { type: imageData.fileType });
                        const url = URL.createObjectURL(blob);
                        
                        img.src = url;
                        img.classList.remove('loading');
                        img.onclick = () => window.open(url, '_blank');
                    }
                }
            } else {
                // Show notification
                const sender = contacts.get(data.fromUserId);
                showNotification(sender?.username || 'New Image', 'Sent you an image');
                
                // Add unread indicator
                const contactDiv = document.getElementById(`contact-${data.fromUserId}`);
                if (contactDiv && !contactDiv.classList.contains('has-unread')) {
                    contactDiv.classList.add('has-unread');
                }
            }
        }
    } catch (error) {
        console.error('Error fetching image:', error);
    }
});

// Display image message
function displayImageMessage(imageData, isSent = false, senderInfo = null) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const emptyMessage = messagesContainer.querySelector('div[style*="text-align: center"]');
    if (emptyMessage) emptyMessage.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = imageData.messageId;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-bubble';
    
    if (!isSent && senderInfo) {
        const senderName = document.createElement('div');
        senderName.className = 'message-sender';
        senderName.textContent = senderInfo.username || 'Unknown';
        contentDiv.appendChild(senderName);
    }
    
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    
    const img = document.createElement('img');
    img.className = 'message-image loading';
    img.alt = isSent ? 'Sent image' : 'Received image';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time-overlay';
    timeDiv.textContent = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    if (isSent) {
        (async () => {
            try {
                const decryptedBuffer = await encryption.decryptFile(
                    imageData.encrypted,
                    imageData.iv,
                    currentChatUser
                );
                const blob = new Blob([decryptedBuffer], { type: imageData.fileType });
                const url = URL.createObjectURL(blob);
                img.src = url;
                img.classList.remove('loading');
                img.onclick = () => window.open(url, '_blank');
            } catch (error) {
                console.error('Error displaying sent image:', error);
                img.alt = 'Error loading image';
                img.classList.remove('loading');
            }
        })();
    }
    
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(timeDiv);
    contentDiv.appendChild(imageWrapper);
    
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Image attachment button
document.getElementById('attachImageBtn').addEventListener('click', () => {
    if (!currentChatUser) {
        alert('Please select a contact first');
        return;
    }
    document.getElementById('imageInput').click();
});

// Handle image selection
document.getElementById('imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    if (file.size > MAX_IMAGE_SIZE) {
        alert('Image size should be less than 10MB');
        return;
    }
    
    if (!currentChatUser || !isUserOnline(currentChatUser)) {
        showOfflineToast('User is offline. Cannot send images.');
        return;
    }
    
    await uploadImageViaHTTP(file, currentChatUser);
    e.target.value = '';
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch(`${API_URL}/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }

    localStorage.clear();
    socket.disconnect();
    window.location.href = '/login.html';
});

// Show notification
function showNotification(title, message) {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body: message,
            icon: '/notification.png'
        });
    }
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// Initialize
initEncryption();
