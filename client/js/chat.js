// Define the server URL
const SERVER_URL = 'https://test-secure-chat-app.onrender.com';
const API_URL = `${SERVER_URL}/api`;

// Initialize Socket.IO with error handling
let socket;

try {
    // Try to connect to the server
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });
    
    // Connection event handlers
    socket.on('connect', () => {
        console.log('Connected to server');
        // Re-join room if reconnecting
        if (localStorage.getItem('userId')) {
            socket.emit('join', {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            });
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
        alert('Unable to connect to server. Please make sure the server is running.');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        if (reason === 'io server disconnect') {
            // Server disconnected, try to reconnect
            socket.connect();
        }
    });
    
} catch (error) {
    console.error('Failed to initialize Socket.IO:', error);
    alert('Failed to initialize chat connection. Please check if Socket.IO library is loaded.');
}

const encryption = new E2EEncryption();
let currentChatUser = null;
let contacts = new Map();
let typingTimeout;
let onlineUsers = new Set();
let messageBuffer = new Map(); // Local buffer for messages
let processedMessages = new Set(); // Track processed message IDs to prevent duplicates

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

// Initialize default chat header
document.getElementById('chatWith').textContent = '';

// Show offline toast notification
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
        // Remove empty state if it exists
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

// Store message in local buffer (without duplicates)
function storeMessageInBuffer(userId, message, type, timestamp = new Date(), messageId = null) {
    if (!messageBuffer.has(userId)) {
        messageBuffer.set(userId, []);
    }
    
    // Generate or use provided message ID
    const id = messageId || generateMessageId(message, timestamp.getTime(), userId);
    
    // Check if message already exists
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

// Update send button and input based on user status
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

// Socket connection
socket.on('connect', () => {
    socket.emit('join', {
        userId: localStorage.getItem('userId'),
        username: localStorage.getItem('username')
    });
});

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
            
            // Add to contacts
            contacts.set(user.userId, user);

            // Mark as online if they are
            if (user.isOnline) {
                onlineUsers.add(user.userId);
            }

            // Update empty state
            updateContactsEmptyState();
            
            displayContact(user);

            // Notify the other user that they've been added
            socket.emit('contact-added', {
                targetUserId: user.userId,
                addedBy: {
                    userId: localStorage.getItem('userId'),
                    username: localStorage.getItem('username')
                }
            });

            // Initiate key exchange
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
    
    // Check if contact already exists
    if (!contacts.has(addedBy.userId)) {
        // Fetch user details
        try {
            const response = await fetch(`${API_URL}/user/${addedBy.userId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                contacts.set(user.userId, user);
                
                // Mark as online
                onlineUsers.add(user.userId);

                // Update empty state
                updateContactsEmptyState();
                
                displayContact(user);
                
                // Show notification
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

    // Remove empty state if exists
    const emptyState = contactsList.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    // Check if contact already exists
    let contactDiv = document.getElementById(`contact-${user.userId}`);
    
    if (!contactDiv) {
        contactDiv = document.createElement('div');
        contactDiv.className = 'contact-item';
        contactDiv.id = `contact-${user.userId}`;
        contactsList.appendChild(contactDiv);
    }

    // Update contact HTML
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
    
    // Update UI
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    document.getElementById(`contact-${user.userId}`).classList.add('active');

    // Update chat header with online status
    const isOnline = onlineUsers.has(user.userId);
    document.getElementById('chatWith').innerHTML = `
        ${user.username} 
        <span class="status-badge ${isOnline ? 'online' : 'offline'}">
            ${isOnline ? '● Online' : '● Offline'}
        </span>
    `;

    // Update message controls based on online status
    updateMessageControls();
    
    // Clear messages
    document.getElementById('messagesContainer').innerHTML = '';

    // Remove unread indicator
    const contactDiv = document.getElementById(`contact-${user.userId}`);
    if (contactDiv) {
        contactDiv.classList.remove('has-unread');
    }

    // Clear processed messages for this chat to allow fresh display
    processedMessages.clear();
    
    // Load buffered messages
    const bufferedMessages = getBufferedMessages(user.userId);
    if (bufferedMessages.length > 0) {
        bufferedMessages.forEach(msg => {
            if (!processedMessages.has(msg.id)) {
                processedMessages.add(msg.id);
                displayMessage(msg.message, msg.type, msg.fromUserId, msg.timestamp);
            }
        });
    } else {
        // Show start conversation message
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
            // Generate unique ID for this message
            const messageId = `${msgData.id || Date.now()}-${fromUserId}`;
            
            // Skip if already processed
            if (processedMessages.has(messageId)) {
                continue;
            }
            
            // Decrypt message
            const decryptedMessage = await encryption.decryptMessage(
                msgData.encryptedMessage,
                msgData.iv,
                fromUserId
            );
            
            // Store in buffer with unique ID
            storeMessageInBuffer(fromUserId, decryptedMessage, 'received', new Date(msgData.timestamp), messageId);
            
            // Display if this is the current chat
            if (currentChatUser === fromUserId) {
                processedMessages.add(messageId);
                displayMessage(decryptedMessage, 'received', fromUserId, new Date(msgData.timestamp));
            } else {
                // Add unread indicator
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
    
    // Update contact if exists
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = true;
        displayContact(user);
        
        // Update chat header if this is current chat
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
    
    // Update contact if exists
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = false;
        displayContact(user);
        
        // Update chat header if this is current chat
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
    
    // Send public key to target user
    socket.emit('key-exchange', {
        targetUserId,
        publicKey,
        type: 'public-key'
    });
    
    // Store AES key temporarily
    encryption.tempAESKey = aesKey;
}

// Handle key exchange
socket.on('key-exchange', async (data) => {
    if (data.type === 'public-key') {
        // Import sender's public key
        const publicKey = await encryption.importPublicKey(data.publicKey);
        
        // Generate and encrypt AES key
        const aesKey = await encryption.generateAESKey();
        encryption.setSharedSecret(data.fromUserId, aesKey);
        
        const encryptedAESKey = await encryption.encryptAESKey(aesKey, publicKey);
        
        // Send encrypted AES key back
        socket.emit('key-exchange', {
            targetUserId: data.fromUserId,
            publicKey: encryptedAESKey,
            type: 'aes-key'
        });
    } else if (data.type === 'aes-key') {
        // Decrypt AES key
        const aesKey = await encryption.decryptAESKey(data.publicKey);
        encryption.setSharedSecret(data.fromUserId, aesKey);
    }
});

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
// The keydown event is now properly handled in textarea-resize.js

// Add input event for typing indicator
document.getElementById('messageInput').addEventListener('input', function() {
    handleTyping();
});

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message || !currentChatUser) return;
    
    // Check if user is online
    if (!isUserOnline(currentChatUser)) {
        const user = contacts.get(currentChatUser);
        showOfflineToast(`${user?.username || 'User'} is offline. Message cannot be sent.`);
        return;
    }
    
    try {
        // Encrypt message
        const { encrypted, iv } = await encryption.encryptMessage(message, currentChatUser);
        
        const timestamp = new Date();
        const messageId = generateMessageId(message, timestamp.getTime(), localStorage.getItem('userId'));
        
        // Send encrypted message with sender info
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
        
        // Store in local buffer
        storeMessageInBuffer(currentChatUser, message, 'sent', timestamp, messageId);
        processedMessages.add(messageId);
        
        // Display message in UI
        displayMessage(message, 'sent');
        
        // Clear and reset textarea using the exported function
        if (window.resetTextareaHeight) {
            window.resetTextareaHeight();
        } else {
            // Fallback if function not available
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
        // Generate or use message ID
        const messageId = data.messageId || `${data.fromUserId}-${new Date(data.timestamp).getTime()}`;
        
        // Skip if already processed
        if (processedMessages.has(messageId)) {
            return;
        }
        
        // Check if sender is in contacts, if not add them
        if (!contacts.has(data.fromUserId)) {
            // Fetch sender details
            const response = await fetch(`${API_URL}/user/${data.fromUserId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                contacts.set(user.userId, user);
                
                // Mark as online since they're sending messages
                onlineUsers.add(user.userId);
                
                // Update empty state
                updateContactsEmptyState();
                
                displayContact(user);
            }
        }
        
        // Decrypt message
        const decryptedMessage = await encryption.decryptMessage(
            data.encryptedMessage,
            data.iv,
            data.fromUserId
        );
        
        // Mark as processed
        processedMessages.add(messageId);
        
        // Store in buffer
        storeMessageInBuffer(data.fromUserId, decryptedMessage, 'received', new Date(data.timestamp), messageId);
        
        // Display message only if it's from current chat
        if (currentChatUser === data.fromUserId) {
            displayMessage(decryptedMessage, 'received', data.fromUserId, new Date(data.timestamp));
        } else {
            // Show notification for message from other user
            const sender = contacts.get(data.fromUserId);
            showNotification(sender?.username || 'New Message', decryptedMessage);
            
            // Add unread indicator to contact
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
    
    // Remove empty state or no-chat-selected if exists
    const emptyMessage = messagesContainer.querySelector('div[style*="text-align: center"]');
    const noChatSelected = messagesContainer.querySelector('.no-chat-selected');
    if (emptyMessage) emptyMessage.remove();
    if (noChatSelected) noChatSelected.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add sender name for received messages
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
    
    // Validate image
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('Image size should be less than 5MB');
        return;
    }
    
    await sendImage(file);
    
    // Clear the input
    e.target.value = '';
});

// Send encrypted image
async function sendImage(file) {
    if (!currentChatUser || !isUserOnline(currentChatUser)) {
        showOfflineToast('User is offline. Cannot send images.');
        return;
    }
    
    try {
        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // Encrypt the image data
        const { encrypted, iv } = await encryption.encryptFile(
            arrayBuffer,
            currentChatUser
        );
        
        const messageId = `${Date.now()}-${Math.random()}`;
        
        // Prepare image metadata
        const imageData = {
            encrypted: encrypted,
            iv: iv,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            messageId: messageId
        };
        
        // Send via socket
        socket.emit('encrypted-image', {
            targetUserId: currentChatUser,
            imageData: imageData,
            messageId: messageId,
            senderInfo: {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            }
        });
        
        // Display in local chat
        displayImageMessage(imageData, true);
        
    } catch (error) {
        console.error('Error sending image:', error);
        alert('Failed to send image');
    }
}

// Display image message in chat
function displayImageMessage(imageData, isSent = false, senderInfo = null) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    // Remove empty state or welcome screen if exists
    const welcomeScreen = messagesContainer.querySelector('.welcome-screen');
    const emptyMessage = messagesContainer.querySelector('div[style*="text-align: center"]');
    if (welcomeScreen) welcomeScreen.remove();
    if (emptyMessage) emptyMessage.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = imageData.messageId;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-bubble';
    
    // Add sender name for received messages (Yellow color in CSS)
    if (!isSent && senderInfo) {
        const senderName = document.createElement('div');
        senderName.className = 'message-sender';
        senderName.textContent = senderInfo.username || 'Unknown';
        contentDiv.appendChild(senderName);
    }
    
    // Create image wrapper with relative position
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    
    const img = document.createElement('img');
    img.className = 'message-image loading';
    img.alt = isSent ? 'Sent image' : 'Received image';
    
    // Create time element inside the image wrapper
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time-overlay';
    timeDiv.textContent = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    if (isSent) {
        // For sent images, decrypt and display immediately
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
    } else {
        // Store data for later decryption when received
        messageDiv.dataset.imageData = JSON.stringify(imageData);
    }
    
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(timeDiv);
    contentDiv.appendChild(imageWrapper);
    
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Handle receiving encrypted images
socket.on('receive-image', async (data) => {
    const { imageData, fromUserId, senderInfo } = data;
    
    // Only process if this is the current chat
    if (fromUserId !== currentChatUser) {
        return;
    }
    
    // Display received image with sender info
    displayImageMessage(imageData, false, senderInfo);
    
    // Decrypt and display
    try {
        const messageDiv = document.querySelector(`[data-message-id="${imageData.messageId}"]`);
        if (!messageDiv) {
            console.error('Message div not found');
            return;
        }
        
        const img = messageDiv.querySelector('img');
        if (!img) {
            console.error('Image element not found');
            return;
        }
        
        const decryptedBuffer = await encryption.decryptFile(
            imageData.encrypted,
            imageData.iv,
            fromUserId
        );
        
        const blob = new Blob([decryptedBuffer], { type: imageData.fileType });
        const url = URL.createObjectURL(blob);
        
        img.src = url;
        img.classList.remove('loading');
        img.onclick = () => window.open(url, '_blank');
        
    } catch (error) {
        console.error('Error decrypting image:', error);
        const messageDiv = document.querySelector(`[data-message-id="${imageData.messageId}"]`);
        if (messageDiv) {
            const img = messageDiv.querySelector('img');
            if (img) {
                img.alt = 'Error decrypting image';
                img.classList.remove('loading');
            }
        }
    }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        // Update online status
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
// loadContacts();
