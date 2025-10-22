class E2EEncryption {
    constructor() {
        this.keyPair = null;
        this.sharedSecrets = new Map();
    }

    // Generate RSA key pair for key exchange
    async generateKeyPair() {
        this.keyPair = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256"
            },
            true,
            ["encrypt", "decrypt"]
        );
        return this.keyPair;
    }

    // Export public key
    async exportPublicKey() {
        const publicKey = await window.crypto.subtle.exportKey(
            "spki",
            this.keyPair.publicKey
        );
        return this.arrayBufferToBase64(publicKey);
    }

    // Import public key
    async importPublicKey(publicKeyBase64) {
        const publicKeyBuffer = this.base64ToArrayBuffer(publicKeyBase64);
        return await window.crypto.subtle.importKey(
            "spki",
            publicKeyBuffer,
            {
                name: "RSA-OAEP",
                hash: "SHA-256"
            },
            true,
            ["encrypt"]
        );
    }

    // Generate AES key for message encryption
    async generateAESKey() {
        return await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    // Encrypt AES key with RSA public key
    async encryptAESKey(aesKey, publicKey) {
        const exportedKey = await window.crypto.subtle.exportKey("raw", aesKey);
        const encryptedKey = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP"
            },
            publicKey,
            exportedKey
        );
        return this.arrayBufferToBase64(encryptedKey);
    }

    // Decrypt AES key with RSA private key
    async decryptAESKey(encryptedKeyBase64) {
        const encryptedKey = this.base64ToArrayBuffer(encryptedKeyBase64);
        const decryptedKey = await window.crypto.subtle.decrypt(
            {
                name: "RSA-OAEP"
            },
            this.keyPair.privateKey,
            encryptedKey
        );
        return await window.crypto.subtle.importKey(
            "raw",
            decryptedKey,
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    // Encrypt message with AES
    async encryptMessage(message, userId) {
        const aesKey = this.sharedSecrets.get(userId);
        if (!aesKey) throw new Error("No shared key with this user");

        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const encryptedData = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            aesKey,
            data
        );

        return {
            encrypted: this.arrayBufferToBase64(encryptedData),
            iv: this.arrayBufferToBase64(iv)
        };
    }

    // Decrypt message with AES
    async decryptMessage(encryptedMessage, iv, userId) {
        const aesKey = this.sharedSecrets.get(userId);
        if (!aesKey) throw new Error("No shared key with this user");

        const encryptedData = this.base64ToArrayBuffer(encryptedMessage);
        const ivBuffer = this.base64ToArrayBuffer(iv);

        const decryptedData = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: ivBuffer
            },
            aesKey,
            encryptedData
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    }

    // Add these methods to your E2EEncryption class

    // Encrypt file/image with AES
    async encryptFile(fileBuffer, userId) {
        const aesKey = this.sharedSecrets.get(userId);
        if (!aesKey) throw new Error("No shared key with this user");
        
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedData = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            aesKey,
            fileBuffer
        );
        
        return {
            encrypted: this.arrayBufferToBase64(encryptedData),
            iv: this.arrayBufferToBase64(iv)
        };
    }

    // Decrypt file/image with AES
    async decryptFile(encryptedFile, iv, userId) {
        const aesKey = this.sharedSecrets.get(userId);
        if (!aesKey) throw new Error("No shared key with this user");
        
        const encryptedData = this.base64ToArrayBuffer(encryptedFile);
        const ivBuffer = this.base64ToArrayBuffer(iv);
        
        const decryptedData = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: ivBuffer
            },
            aesKey,
            encryptedData
        );
        
        return decryptedData;
    }

    // Store shared secret for a user
    setSharedSecret(userId, aesKey) {
        this.sharedSecrets.set(userId, aesKey);
    }

    // Utility functions
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = window.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}