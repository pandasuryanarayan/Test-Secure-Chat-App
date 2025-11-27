// Define the server URL
const SERVER_URL = 'http://localhost:3000'; // Your Express server URL
// const SERVER_URL = 'https://secure-chat-app-8typ.onrender.com';
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
        maxHttpBufferSize: 1e6,
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

// Track key exchange status for each user
let keyExchangeStatus = new Map(); // userId -> boolean (true if completed)

// Image handling utilities
const imageChunks = new Map();
const CHUNK_SIZE = 256 * 1024;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// ============================================
// DOM Element References (New IDs)
// ============================================
const DOM = {
    // Profile
    profileUsername: () => document.getElementById('profileUsername'),
    profileUserId: () => document.getElementById('profileUserId'),
    copyIdBtn: () => document.getElementById('copyIdBtn'),
    
    // Search/Connect
    contactSearchInput: () => document.getElementById('contactSearchInput'),
    connectBtn: () => document.getElementById('connectBtn'),
    
    // Contacts
    contactsList: () => document.getElementById('contactsList'),
    
    // Chat Header
    chatPartnerName: () => document.getElementById('chatPartnerName'),
    chatPartnerStatus: () => document.getElementById('chatPartnerStatus'),
    
    // Messages
    messagesContainer: () => document.getElementById('messagesContainer'),
    
    // Input
    messageInput: () => document.getElementById('messageInput'),
    sendBtn: () => document.getElementById('sendBtn'),
    emojiBtn: () => document.getElementById('emojiBtn'),
    attachImageBtn: () => document.getElementById('attachImageBtn'),
    imageInput: () => document.getElementById('imageInput'),
    
    // Typing
    typingIndicator: () => document.getElementById('typingIndicator'),
    typingUserName: () => document.getElementById('typingUserName'),
    
    // Other
    logoutBtn: () => document.getElementById('logoutBtn'),
    toastNotification: () => document.getElementById('toastNotification')
};

// Initialize encryption
async function initEncryption() {
    await encryption.generateKeyPair();
}

// Check authentication
if (!localStorage.getItem('token')) {
    window.location.href = './login.html';
}

// Display user info (using new IDs)
function initUserDisplay() {
    const profileUsername = DOM.profileUsername();
    const profileUserId = DOM.profileUserId();
    const chatPartnerName = DOM.chatPartnerName();
    
    if (profileUsername) {
        profileUsername.textContent = localStorage.getItem('username') || 'User';
    }
    if (profileUserId) {
        profileUserId.textContent = localStorage.getItem('userId') || '';
    }
    if (chatPartnerName) {
        chatPartnerName.textContent = 'Select a contact';
    }
}

// Show toast notification (uses new toast element)
function showOfflineToast(message, type = 'info') {
    // Use global showToast if available (from app-init.js)
    if (window.showToast) {
        window.showToast(message, type);
        return;
    }
    
    // Fallback
    const toast = DOM.toastNotification();
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'sc-toast sc-toast--visible';
    
    if (type === 'error') {
        toast.classList.add('sc-toast--error');
    } else if (type === 'success') {
        toast.classList.add('sc-toast--success');
    }
    
    setTimeout(() => {
        toast.classList.remove('sc-toast--visible');
    }, 3000);
}

// Check if user is online and key exchange is complete
function isUserOnline(userId) {
    return onlineUsers.has(userId);
}

// Check if key exchange is complete for a user
function isKeyExchangeComplete(userId) {
    return keyExchangeStatus.get(userId) === true;
}

// Check if user is ready to chat (online + key exchange complete)
function isUserReadyToChat(userId) {
    return isUserOnline(userId) && isKeyExchangeComplete(userId);
}

// Update empty state in contacts list
function updateContactsEmptyState() {
    const contactsList = DOM.contactsList();
    if (!contactsList) return;
    
    const hasContacts = contacts.size > 0;
    
    if (!hasContacts) {
        contactsList.innerHTML = `
            <div class="sc-contacts__empty">
                <div class="sc-contacts__empty-icon">
                    <svg class="sc-icon sc-icon--xl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                </div>
                <p class="sc-contacts__empty-title">No contacts yet</p>
                <p class="sc-contacts__empty-subtitle">Add someone to start chatting</p>
            </div>
        `;
    } else {
        const emptyState = contactsList.querySelector('.sc-contacts__empty');
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
    const messageInput = DOM.messageInput();
    const sendBtn = DOM.sendBtn();
    const emojiBtn = DOM.emojiBtn();
    const attachImageBtn = DOM.attachImageBtn();
    
    if (!messageInput || !sendBtn) return;
    
    if (!currentChatUser) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        if (emojiBtn) emojiBtn.disabled = true;
        if (attachImageBtn) attachImageBtn.disabled = true;
        messageInput.placeholder = 'Select a contact to start chatting';
        return;
    }
    
    const isOnline = isUserOnline(currentChatUser);
    const keyExchangeComplete = isKeyExchangeComplete(currentChatUser);
    const user = contacts.get(currentChatUser);
    
    if (!isOnline) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        if (emojiBtn) emojiBtn.disabled = true;
        if (attachImageBtn) attachImageBtn.disabled = true;
        messageInput.placeholder = `${user?.username || 'User'} is offline`;
    } else if (!keyExchangeComplete) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        if (emojiBtn) emojiBtn.disabled = true;
        if (attachImageBtn) attachImageBtn.disabled = true;
        messageInput.placeholder = 'Securing connection...';
    } else {
        messageInput.disabled = false;
        sendBtn.disabled = false;
        if (emojiBtn) emojiBtn.disabled = false;
        if (attachImageBtn) attachImageBtn.disabled = false;
        messageInput.placeholder = 'Type a secure message...';
    }
}

// Copy ID button
document.addEventListener('DOMContentLoaded', () => {
    const copyIdBtn = DOM.copyIdBtn();
    
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', async () => {
            const userId = localStorage.getItem('userId');
            
            try {
                await navigator.clipboard.writeText(userId);
                
                // Store original content
                const originalHTML = copyIdBtn.innerHTML;
                
                // Add success state
                copyIdBtn.classList.add('sc-profile__copy-btn--copied');
                
                // Change to checkmark icon
                copyIdBtn.innerHTML = `
                    <svg class="sc-icon sc-icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span class="sc-profile__copy-text">Copied!</span>
                `;
                
                // Reset after 2 seconds
                setTimeout(() => {
                    copyIdBtn.classList.remove('sc-profile__copy-btn--copied');
                    copyIdBtn.innerHTML = originalHTML;
                }, 2000);
                
            } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = userId;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                // Show feedback
                const originalHTML = copyIdBtn.innerHTML;
                copyIdBtn.classList.add('sc-profile__copy-btn--copied');
                copyIdBtn.innerHTML = `
                    <svg class="sc-icon sc-icon--xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span class="sc-profile__copy-text">Copied!</span>
                `;
                
                setTimeout(() => {
                    copyIdBtn.classList.remove('sc-profile__copy-btn--copied');
                    copyIdBtn.innerHTML = originalHTML;
                }, 2000);
            }
        });
    }
});

// Search and connect with user
document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = DOM.connectBtn();
    const contactSearchInput = DOM.contactSearchInput();
    
    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            const searchId = contactSearchInput?.value.trim();
            
            if (!searchId || searchId.length !== 6) {
                showOfflineToast('Please enter a valid 6-digit ID', 'error');
                return;
            }

            if (searchId === localStorage.getItem('userId')) {
                showOfflineToast('You cannot add yourself as a contact', 'error');
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

                    // Initiate key exchange
                    await initiateKeyExchange(user.userId);
                    
                    if (contactSearchInput) contactSearchInput.value = '';
                    showOfflineToast(`Connected with ${user.username}`, 'success');
                } else {
                    const error = await response.json();
                    showOfflineToast(error.message || 'User not found', 'error');
                }
            } catch (error) {
                showOfflineToast('Error connecting to user', 'error');
            }
        });
    }
    
    // Allow Enter key to connect
    if (contactSearchInput) {
        contactSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                connectBtn?.click();
            }
        });
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
                
                // Initiate key exchange with new contact
                await initiateKeyExchange(user.userId);
            }
        } catch (error) {
            console.error('Error fetching contact:', error);
        }
    }
});

// Display contact in sidebar (using new classes)
function displayContact(user) {
    const contactsList = DOM.contactsList();
    if (!contactsList) return;
    
    const emptyState = contactsList.querySelector('.sc-contacts__empty');
    if (emptyState) {
        emptyState.remove();
    }
    
    let contactDiv = document.getElementById(`contact-${user.userId}`);
    
    if (!contactDiv) {
        contactDiv = document.createElement('div');
        contactDiv.className = 'sc-contact';
        contactDiv.id = `contact-${user.userId}`;
        contactsList.appendChild(contactDiv);
    }

    const isOnline = onlineUsers.has(user.userId);
    
    contactDiv.innerHTML = `
        <div class="sc-contact__avatar">
            <svg class="sc-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <span class="sc-contact__status-dot ${isOnline ? 'sc-contact__status-dot--online' : 'sc-contact__status-dot--offline'}"></span>
        </div>
        <div class="sc-contact__info">
            <div class="sc-contact__name">${user.username}</div>
            <div class="sc-contact__preview">ID: ${user.userId}</div>
        </div>
    `;

    contactDiv.onclick = () => selectContact(user);
}

// Select contact for chat
function selectContact(user) {
    currentChatUser = user.userId;
    
    // Update active state (using new classes)
    document.querySelectorAll('.sc-contact').forEach(item => {
        item.classList.remove('sc-contact--active');
    });
    
    const contactElement = document.getElementById(`contact-${user.userId}`);
    if (contactElement) {
        contactElement.classList.add('sc-contact--active');
        contactElement.classList.remove('sc-contact--unread');
    }

    const isOnline = onlineUsers.has(user.userId);
    const keyExchangeComplete = isKeyExchangeComplete(user.userId);
    
    // Update chat header (using new IDs)
    const chatPartnerName = DOM.chatPartnerName();
    const chatPartnerStatus = DOM.chatPartnerStatus();
    
    if (chatPartnerName) {
        chatPartnerName.textContent = user.username;
    }
    
    if (chatPartnerStatus) {
        if (!isOnline) {
            chatPartnerStatus.textContent = 'Offline';
            chatPartnerStatus.className = 'sc-chat__user-status';
        } else if (!keyExchangeComplete) {
            chatPartnerStatus.textContent = 'Securing connection...';
            chatPartnerStatus.className = 'sc-chat__user-status';
        } else {
            chatPartnerStatus.textContent = 'Online';
            chatPartnerStatus.className = 'sc-chat__user-status sc-chat__user-status--online';
        }
    }

    updateMessageControls();
    
    const messagesContainer = DOM.messagesContainer();
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
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
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="sc-welcome sc-welcome--mini">
                    <div class="sc-welcome__icon">
                        <svg class="sc-icon sc-icon--xl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <p class="sc-welcome__description">Start a conversation with ${user.username}</p>
                </div>
            `;
        }
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
                if (contactDiv && !contactDiv.classList.contains('sc-contact--unread')) {
                    contactDiv.classList.add('sc-contact--unread');
                }
            }
        } catch (error) {
            console.error('Error decrypting pending message:', error);
        }
    }
});

// ============================================
// MODIFIED: Handle user online status with key exchange
// ============================================
socket.on('user-online', async (data) => {
    const { userId, username } = data;
    
    console.log(`User ${username} (${userId}) came online`);
    
    // Add to online users
    onlineUsers.add(userId);
    
    // Reset key exchange status - needs to be re-established
    keyExchangeStatus.set(userId, false);
    
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = true;
        
        // Update contact display
        displayContact(user);
        
        // Show notification
        showOfflineToast(`${username} is online`, 'info');
        
        // If this is the current chat user, update UI but keep disabled
        if (currentChatUser === userId) {
            const chatPartnerName = DOM.chatPartnerName();
            const chatPartnerStatus = DOM.chatPartnerStatus();
            
            if (chatPartnerName) {
                chatPartnerName.textContent = username;
            }
            if (chatPartnerStatus) {
                chatPartnerStatus.textContent = 'Securing connection...';
                chatPartnerStatus.className = 'sc-chat__user-status';
            }
            
            // Disable controls while securing connection
            updateMessageControls();
        }
        
        // Re-initiate key exchange with the user who came online
        console.log(`Initiating key exchange with ${username}`);
        await initiateKeyExchange(userId);
    }
});

// Handle user offline status
socket.on('user-offline', (data) => {
    const { userId } = data;
    
    console.log(`User ${userId} went offline`);
    
    // Remove from online users
    onlineUsers.delete(userId);
    
    // Clear key exchange status
    keyExchangeStatus.set(userId, false);
    
    if (contacts.has(userId)) {
        const user = contacts.get(userId);
        user.isOnline = false;
        displayContact(user);
        
        if (currentChatUser === userId) {
            const chatPartnerStatus = DOM.chatPartnerStatus();
            if (chatPartnerStatus) {
                chatPartnerStatus.textContent = 'Offline';
                chatPartnerStatus.className = 'sc-chat__user-status';
            }
            updateMessageControls();
        }
    }
});

// ============================================
// MODIFIED: Key exchange with completion tracking
// ============================================
async function initiateKeyExchange(targetUserId) {
    console.log(`Starting key exchange with user ${targetUserId}`);
    
    try {
        // Mark as in progress
        keyExchangeStatus.set(targetUserId, false);
        
        const publicKey = await encryption.exportPublicKey();
        const aesKey = await encryption.generateAESKey();
        
        socket.emit('key-exchange', {
            targetUserId,
            publicKey,
            type: 'public-key'
        });
        
        encryption.tempAESKey = aesKey;
        
        console.log(`Key exchange initiated with user ${targetUserId}`);
    } catch (error) {
        console.error('Error initiating key exchange:', error);
        keyExchangeStatus.set(targetUserId, false);
    }
}

// Handle key exchange
socket.on('key-exchange', async (data) => {
    try {
        if (data.type === 'public-key') {
            console.log(`Received public key from user ${data.fromUserId}`);
            
            const publicKey = await encryption.importPublicKey(data.publicKey);
            const aesKey = await encryption.generateAESKey();
            encryption.setSharedSecret(data.fromUserId, aesKey);
            
            const encryptedAESKey = await encryption.encryptAESKey(aesKey, publicKey);
            
            socket.emit('key-exchange', {
                targetUserId: data.fromUserId,
                publicKey: encryptedAESKey,
                type: 'aes-key'
            });
            
            console.log(`Sent AES key to user ${data.fromUserId}`);
            
            // Mark key exchange as complete (receiver side)
            keyExchangeStatus.set(data.fromUserId, true);
            
            // Notify completion
            socket.emit('key-exchange', {
                targetUserId: data.fromUserId,
                type: 'exchange-complete'
            });
            
            console.log(`Key exchange completed with user ${data.fromUserId}`);
            
            // Update UI if this is current chat
            if (currentChatUser === data.fromUserId) {
                const chatPartnerStatus = DOM.chatPartnerStatus();
                if (chatPartnerStatus && isUserOnline(data.fromUserId)) {
                    chatPartnerStatus.textContent = 'Online';
                    chatPartnerStatus.className = 'sc-chat__user-status sc-chat__user-status--online';
                }
                updateMessageControls();
            }
            
            // Update contact display
            const user = contacts.get(data.fromUserId);
            if (user) {
                displayContact(user);
            }
            
        } else if (data.type === 'aes-key') {
            console.log(`Received AES key from user ${data.fromUserId}`);
            
            const aesKey = await encryption.decryptAESKey(data.publicKey);
            encryption.setSharedSecret(data.fromUserId, aesKey);
            
            console.log(`AES key set for user ${data.fromUserId}`);
            
            // Mark key exchange as complete (initiator side)
            keyExchangeStatus.set(data.fromUserId, true);
            
            console.log(`Key exchange completed with user ${data.fromUserId}`);
            
            // Update UI if this is current chat
            if (currentChatUser === data.fromUserId) {
                const chatPartnerStatus = DOM.chatPartnerStatus();
                if (chatPartnerStatus && isUserOnline(data.fromUserId)) {
                    chatPartnerStatus.textContent = 'Online';
                    chatPartnerStatus.className = 'sc-chat__user-status sc-chat__user-status--online';
                }
                updateMessageControls();
            }
            
            // Update contact display
            const user = contacts.get(data.fromUserId);
            if (user) {
                displayContact(user);
            }
            
        } else if (data.type === 'exchange-complete') {
            console.log(`Key exchange completion confirmed by user ${data.fromUserId}`);
            
            // Ensure it's marked as complete
            keyExchangeStatus.set(data.fromUserId, true);
            
            // Update UI if this is current chat
            if (currentChatUser === data.fromUserId) {
                const chatPartnerStatus = DOM.chatPartnerStatus();
                if (chatPartnerStatus && isUserOnline(data.fromUserId)) {
                    chatPartnerStatus.textContent = 'Online';
                    chatPartnerStatus.className = 'sc-chat__user-status sc-chat__user-status--online';
                }
                updateMessageControls();
            }
        }
    } catch (error) {
        console.error('Error in key exchange:', error);
        keyExchangeStatus.set(data.fromUserId, false);
        
        if (currentChatUser === data.fromUserId) {
            updateMessageControls();
        }
    }
});

// Send message
document.addEventListener('DOMContentLoaded', () => {
    const sendBtn = DOM.sendBtn();
    const messageInput = DOM.messageInput();
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    if (messageInput) {
        messageInput.addEventListener('input', handleTyping);
    }
});

async function sendMessage() {
    const messageInput = DOM.messageInput();
    if (!messageInput) return;
    
    const message = messageInput.value.trim();
    
    if (!message || !currentChatUser) return;
    
    // Check if user is online
    if (!isUserOnline(currentChatUser)) {
        const user = contacts.get(currentChatUser);
        showOfflineToast(`${user?.username || 'User'} is offline`, 'error');
        return;
    }
    
    // Check if key exchange is complete
    if (!isKeyExchangeComplete(currentChatUser)) {
        showOfflineToast('Securing connection, please wait...', 'error');
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
        showOfflineToast('Error sending message', 'error');
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
            if (contactDiv && !contactDiv.classList.contains('sc-contact--unread')) {
                contactDiv.classList.add('sc-contact--unread');
            }
        }
        
    } catch (error) {
        console.error('Error decrypting message:', error);
    }
});

// Display message in chat (using new classes)
function displayMessage(message, type, fromUserId = null, timestamp = new Date()) {
    const messagesContainer = DOM.messagesContainer();
    if (!messagesContainer) return;
    
    // Remove welcome message
    const welcomeMessage = messagesContainer.querySelector('.sc-welcome');
    if (welcomeMessage) welcomeMessage.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `sc-message sc-message--${type}`;
    
    const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let senderName = '';
    if (type === 'received' && fromUserId) {
        const sender = contacts.get(fromUserId);
        senderName = `<div class="sc-message__sender">${sender?.username || 'Unknown'}</div>`;
    }
    
    messageDiv.innerHTML = `
        <div class="sc-message__bubble">
            ${senderName}
            <div class="sc-message__text">${escapeHtml(message)}</div>
            <div class="sc-message__time">${time}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Typing indicator
function handleTyping() {
    if (!currentChatUser || !isUserReadyToChat(currentChatUser)) return;
    
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
    const typingIndicator = DOM.typingIndicator();
    const typingUserName = DOM.typingUserName();
    
    if (!typingIndicator) return;
    
    if (data.isTyping && data.userId === currentChatUser) {
        const user = contacts.get(data.userId);
        if (typingUserName) {
            typingUserName.textContent = user?.username || 'User';
        }
        typingIndicator.classList.add('sc-typing--visible');
    } else {
        typingIndicator.classList.remove('sc-typing--visible');
    }
});

// ====================
// IMAGE HANDLING
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

// Upload image via HTTP
async function uploadImageViaHTTP(file, targetUserId) {
    // Check if user is ready to chat
    if (!isUserReadyToChat(targetUserId)) {
        showOfflineToast('Cannot send image. User is offline or connection not secured.', 'error');
        return;
    }
    
    try {
        showOfflineToast('Processing image...');
        
        let fileToUpload = file;
        if (file.size > 1 * 1024 * 1024) {
            showOfflineToast('Compressing image...');
            fileToUpload = await compressImage(file, 1920, 1080, 0.8);
        }
        
        showOfflineToast('Encrypting image...');
        
        const arrayBuffer = await fileToUpload.arrayBuffer();
        const { encrypted, iv } = await encryption.encryptFile(arrayBuffer, targetUserId);
        
        const messageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const chunks = [];
        const chunkSize = 500 * 1024;
        
        for (let i = 0; i < encrypted.length; i += chunkSize) {
            chunks.push(encrypted.slice(i, i + chunkSize));
        }
        
        if (chunks.length > 1) {
            showOfflineToast(`Uploading in ${chunks.length} parts...`);
            
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
        
        displayImageMessage({
            messageId,
            encrypted,
            iv,
            fileName: fileToUpload.name,
            fileType: fileToUpload.type,
            fileSize: fileToUpload.size
        }, true);
        
        socket.emit('image-notification', {
            targetUserId,
            messageId,
            senderInfo: {
                userId: localStorage.getItem('userId'),
                username: localStorage.getItem('username')
            }
        });
        
        showOfflineToast('Image sent!', 'success');
        
    } catch (error) {
        console.error('Error uploading image:', error);
        showOfflineToast('Failed to send image', 'error');
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
                    }
                }
            } else {
                const sender = contacts.get(data.fromUserId);
                showNotification(sender?.username || 'New Image', 'Sent you an image');
                
                const contactDiv = document.getElementById(`contact-${data.fromUserId}`);
                if (contactDiv && !contactDiv.classList.contains('sc-contact--unread')) {
                    contactDiv.classList.add('sc-contact--unread');
                }
            }
        }
    } catch (error) {
        console.error('Error fetching image:', error);
    }
});

// Display image message (using new classes)
function displayImageMessage(imageData, isSent = false, senderInfo = null) {
    const messagesContainer = DOM.messagesContainer();
    if (!messagesContainer) return;
    
    const welcomeMessage = messagesContainer.querySelector('.sc-welcome');
    if (welcomeMessage) welcomeMessage.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `sc-message sc-message--${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = imageData.messageId;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'sc-message__bubble';
    
    if (!isSent && senderInfo) {
        const senderName = document.createElement('div');
        senderName.className = 'sc-message__sender';
        senderName.textContent = senderInfo.username || 'Unknown';
        bubbleDiv.appendChild(senderName);
    }
    
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'sc-message__image-wrapper';
    
    const img = document.createElement('img');
    img.className = 'sc-message__image loading';
    img.alt = isSent ? 'Sent image' : 'Received image';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'sc-message__time-overlay';
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
            } catch (error) {
                console.error('Error displaying sent image:', error);
                img.alt = 'Error loading image';
                img.classList.remove('loading');
            }
        })();
    }
    
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(timeDiv);
    bubbleDiv.appendChild(imageWrapper);
    
    messageDiv.appendChild(bubbleDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Image attachment button
document.addEventListener('DOMContentLoaded', () => {
    const attachImageBtn = DOM.attachImageBtn();
    const imageInput = DOM.imageInput();
    
    if (attachImageBtn) {
        attachImageBtn.addEventListener('click', () => {
            if (!currentChatUser) {
                showOfflineToast('Please select a contact first', 'error');
                return;
            }
            
            if (!isUserReadyToChat(currentChatUser)) {
                showOfflineToast('User is offline or connection not secured', 'error');
                return;
            }
            
            imageInput?.click();
        });
    }
    
    if (imageInput) {
        imageInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!file.type.startsWith('image/')) {
                showOfflineToast('Please select an image file', 'error');
                return;
            }
            
            if (file.size > MAX_IMAGE_SIZE) {
                showOfflineToast('Image size should be less than 10MB', 'error');
                return;
            }
            
            if (!currentChatUser || !isUserReadyToChat(currentChatUser)) {
                showOfflineToast('User is offline or connection not secured', 'error');
                return;
            }
            
            await uploadImageViaHTTP(file, currentChatUser);
            e.target.value = '';
        });
    }
});

// Logout
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = DOM.logoutBtn();
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
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
            window.location.href = './login.html';
        });
    }
});

// Show notification
function showNotification(title, message) {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body: message,
            icon: '/client/notification.png'
        });
    }
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initUserDisplay();
    initEncryption();
    updateContactsEmptyState();
});