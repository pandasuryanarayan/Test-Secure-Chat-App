const API_URL = 'http://localhost:3000/api';
// const API_URL = 'https://secure-chat-app-8typ.onrender.com/api';

// Password hashing utility using Web Crypto API
class PasswordHasher {
    // Hash password with salt
    async hashPassword(password, email) {
        // Use email as part of the salt for uniqueness
        const salt = email.toLowerCase();
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        
        // Hash using SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        // Convert to hex string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hashHex;
    }
    
    // Additional client-side hash for extra security
    async doubleHash(password, email) {
        const firstHash = await this.hashPassword(password, email);
        // Hash again with a different salt pattern
        const secondSalt = `${email}_${window.location.hostname}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(firstHash + secondSalt);
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hashHex;
    }
    
    // Generate random salt for extra security
    generateRandomSalt(length = 16) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
}

const passwordHasher = new PasswordHasher();

// Tab switching
function showTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    if (tab === 'login') {
        loginForm.style.display = 'flex';
        registerForm.style.display = 'none';
        tabBtns[0].classList.add('active');
        tabBtns[1].classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'flex';
        tabBtns[0].classList.remove('active');
        tabBtns[1].classList.add('active');
    }
}

// Show message
function showMessage(message, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
        messageDiv.className = 'message';
    }, 5000);
}

// Show loading state
function setLoading(formId, isLoading) {
    const form = document.getElementById(formId);
    const button = form.querySelector('button[type="submit"]');
    const inputs = form.querySelectorAll('input');
    
    if (isLoading) {
        button.disabled = true;
        button.textContent = formId === 'loginForm' ? 'Logging in...' : 'Registering...';
        inputs.forEach(input => input.disabled = true);
    } else {
        button.disabled = false;
        button.textContent = formId === 'loginForm' ? 'Login' : 'Register';
        inputs.forEach(input => input.disabled = false);
    }
}

// Validate email format
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Validate password strength
function validatePassword(password) {
    if (password.length < 9) {
        return { valid: false, message: 'Password must be at least 9 characters long' };
    }
    // Optional: Add more password requirements
    // if (!/[A-Z]/.test(password)) {
    //     return { valid: false, message: 'Password must contain at least one uppercase letter' };
    // }
    // if (!/[0-9]/.test(password)) {
    //     return { valid: false, message: 'Password must contain at least one number' };
    // }
    return { valid: true };
}

// Login with hashed password
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    // Validate email
    if (!validateEmail(email)) {
        showMessage('Please enter a valid email address', 'error');
        return;
    }
    
    setLoading('loginForm', true);
    
    try {
        // Hash password before sending
        const hashedPassword = await passwordHasher.doubleHash(password, email);
        
        // Create auth token for the request
        const timestamp = Date.now();
        const authToken = await passwordHasher.hashPassword(`${email}${timestamp}`, hashedPassword);
        
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': authToken,
                'X-Timestamp': timestamp.toString()
            },
            body: JSON.stringify({ 
                email: email.toLowerCase(), 
                password: hashedPassword,
                timestamp: timestamp
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store credentials securely
            localStorage.setItem('token', data.token);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('username', data.username);
            
            // Store hashed credentials for auto-login (optional)
            sessionStorage.setItem('sessionActive', 'true');
            
            showMessage('Login successful! Redirecting...', 'success');
            
            // Clear form
            document.getElementById('loginForm').reset();
            
            setTimeout(() => {
                window.location.href = '/client/chat.html';
            }, 1500);
        } else {
            showMessage(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showMessage('Connection error. Please check your internet connection.', 'error');
    } finally {
        setLoading('loginForm', false);
    }
});

// Register with hashed password
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    
    // Validate inputs
    if (username.length < 3) {
        showMessage('Username must be at least 3 characters long', 'error');
        return;
    }
    
    if (!validateEmail(email)) {
        showMessage('Please enter a valid email address', 'error');
        return;
    }
    
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        showMessage(passwordValidation.message, 'error');
        return;
    }
    
    setLoading('registerForm', true);
    
    try {
        // Hash password before sending
        const hashedPassword = await passwordHasher.doubleHash(password, email);
        
        // Create auth token for the request
        const timestamp = Date.now();
        const authToken = await passwordHasher.hashPassword(`${email}${timestamp}`, hashedPassword);
        
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': authToken,
                'X-Timestamp': timestamp.toString()
            },
            body: JSON.stringify({ 
                username: username,
                email: email.toLowerCase(), 
                password: hashedPassword,
                timestamp: timestamp
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store credentials securely
            localStorage.setItem('token', data.token);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('username', data.username);
            
            // Store session
            sessionStorage.setItem('sessionActive', 'true');
            
            showMessage(`Registration successful! Your ID is ${data.userId}. Redirecting...`, 'success');
            
            // Clear form
            document.getElementById('registerForm').reset();
            
            // Show user ID in a more prominent way
            setTimeout(() => {
                if (confirm(`Your unique ID is: ${data.userId}\n\nPlease save this ID. You'll need it to share with others.\n\nClick OK to continue to chat.`)) {
                    window.location.href = '/client/chat.html';
                }
            }, 1000);
        } else {
            showMessage(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showMessage('Connection error. Please check your internet connection.', 'error');
    } finally {
        setLoading('registerForm', false);
    }
});

// Password visibility toggle
function addPasswordToggle() {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    
    passwordInputs.forEach(input => {
        const wrapper = document.createElement('div');
        wrapper.className = 'password-wrapper';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'password-toggle';
        toggleBtn.innerHTML = '👁️';
        toggleBtn.onclick = () => {
            if (input.type === 'password') {
                input.type = 'text';
                toggleBtn.innerHTML = '👁️‍🗨️';
            } else {
                input.type = 'password';
                toggleBtn.innerHTML = '👁️';
            }
        };
        wrapper.appendChild(toggleBtn);
    });
}

// Check if already logged in
if (localStorage.getItem('token') && sessionStorage.getItem('sessionActive')) {
    showMessage('Already logged in. Redirecting...', 'success');
    setTimeout(() => {
        window.location.href = '/client/chat.html';
    }, 1000);
}

// Initialize password toggles
document.addEventListener('DOMContentLoaded', () => {
    addPasswordToggle();
});

// Clear session on tab close (optional)
window.addEventListener('beforeunload', () => {
    // Optional: Clear session when tab is closed
    // sessionStorage.removeItem('sessionActive');
});