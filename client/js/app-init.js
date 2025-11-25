/**
 * SecureChat - App Initialization
 * Handles mobile menu, viewport fixes, and UI interactions
 */

(function() {
    'use strict';

    // ============================================
    // Viewport Height Fix for Mobile
    // ============================================
    const setViewportHeight = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--sc-vh', `${vh}px`);
    };

    // ============================================
    // DOM Elements
    // ============================================
    const elements = {
        // Mobile Header
        menuToggleBtn: document.getElementById('menuToggleBtn'),
        mobileUserStatus: document.getElementById('mobileUserStatus'),
        
        // Sidebar
        sidebar: document.getElementById('sidebar'),
        closeSidebarBtn: document.getElementById('closeSidebarBtn'),
        profileUsername: document.getElementById('profileUsername'),
        profileUserId: document.getElementById('profileUserId'),
        copyIdBtn: document.getElementById('copyIdBtn'),
        contactSearchInput: document.getElementById('contactSearchInput'),
        connectBtn: document.getElementById('connectBtn'),
        contactsList: document.getElementById('contactsList'),
        logoutBtn: document.getElementById('logoutBtn'),
        
        // Chat Area
        chatPartnerName: document.getElementById('chatPartnerName'),
        chatPartnerStatus: document.getElementById('chatPartnerStatus'),
        messagesContainer: document.getElementById('messagesContainer'),
        welcomeAddContactBtn: document.getElementById('welcomeAddContactBtn'),
        typingIndicator: document.getElementById('typingIndicator'),
        typingUserName: document.getElementById('typingUserName'),
        
        // Input Area
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        emojiBtn: document.getElementById('emojiBtn'),
        attachImageBtn: document.getElementById('attachImageBtn'),
        imageInput: document.getElementById('imageInput'),
        emojiPickerContainer: document.getElementById('emojiPickerContainer'),
        
        // Overlay & Modal
        overlay: document.getElementById('overlay'),
        imagePreviewModal: document.getElementById('imagePreviewModal'),
        closeImageModal: document.getElementById('closeImageModal'),
        previewImage: document.getElementById('previewImage'),
        
        // Toast
        toastNotification: document.getElementById('toastNotification')
    };

    // ============================================
    // Sidebar Functions
    // ============================================
    function openSidebar() {
        elements.sidebar?.classList.add('sc-sidebar--active');
        elements.overlay?.classList.add('sc-overlay--active');
        document.body.style.overflow = 'hidden';
        
        // Focus search input after animation
        setTimeout(() => {
            elements.contactSearchInput?.focus();
        }, 300);
    }

    function closeSidebar() {
        elements.sidebar?.classList.remove('sc-sidebar--active');
        elements.overlay?.classList.remove('sc-overlay--active');
        document.body.style.overflow = '';
    }

    // Make functions globally available
    window.openSidebar = openSidebar;
    window.closeSidebar = closeSidebar;

    // ============================================
    // Image Modal Functions
    // ============================================
    function openImageModal(src) {
        if (elements.imagePreviewModal && elements.previewImage) {
            elements.previewImage.src = src;
            elements.imagePreviewModal.classList.add('sc-modal--active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeImageModal() {
        if (elements.imagePreviewModal) {
            elements.imagePreviewModal.classList.remove('sc-modal--active');
            document.body.style.overflow = '';
        }
    }

    // Make functions globally available
    window.openImageModal = openImageModal;
    window.closeImageModal = closeImageModal;

    // ============================================
    // Toast Notification
    // ============================================
    function showToast(message, type = 'info', duration = 3000) {
        const toast = elements.toastNotification;
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
        }, duration);
    }

    // Make showToast globally available
    window.showToast = showToast;

    // ============================================
    // File Validation
    // ============================================
    function validateFileSize(input) {
        const file = input.files?.[0];
        if (file) {
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (file.size > maxSize) {
                showToast('Image size should be less than 10MB', 'error');
                input.value = '';
                return false;
            }
        }
        return true;
    }

    // Make validateFileSize globally available
    window.validateFileSize = validateFileSize;

    // ============================================
    // Event Listeners
    // ============================================
    function initEventListeners() {
        // Viewport height updates
        window.addEventListener('resize', setViewportHeight);
        window.addEventListener('orientationchange', setViewportHeight);

        // Sidebar toggle
        elements.menuToggleBtn?.addEventListener('click', openSidebar);
        elements.closeSidebarBtn?.addEventListener('click', closeSidebar);
        elements.overlay?.addEventListener('click', closeSidebar);
        elements.welcomeAddContactBtn?.addEventListener('click', openSidebar);

        // Close sidebar when contact is selected on mobile
        elements.contactsList?.addEventListener('click', (e) => {
            if (e.target.closest('.sc-contact') && window.innerWidth <= 768) {
                setTimeout(closeSidebar, 100);
            }
        });

        // Close sidebar on resize to desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        });

        // Image modal
        elements.closeImageModal?.addEventListener('click', closeImageModal);
        elements.imagePreviewModal?.querySelector('.sc-modal__backdrop')?.addEventListener('click', closeImageModal);

        // Image input validation
        elements.imageInput?.addEventListener('change', function() {
            validateFileSize(this);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape to close modal/sidebar
            if (e.key === 'Escape') {
                closeImageModal();
                if (window.innerWidth <= 768) {
                    closeSidebar();
                }
            }
        });

        // Handle image clicks in messages for preview
        document.addEventListener('click', (e) => {
            const img = e.target.closest('.sc-message__image');
            if (img) {
                openImageModal(img.src);
            }
        });
    }

    // ============================================
    // Set User Info Display
    // ============================================
    function setUserInfo() {
        const username = localStorage.getItem('username');
        const userId = localStorage.getItem('userId');
        
        if (elements.profileUsername && username) {
            elements.profileUsername.textContent = username;
        }
        
        if (elements.profileUserId && userId) {
            elements.profileUserId.textContent = userId;
        }
        
        if (elements.mobileUserStatus && username) {
            elements.mobileUserStatus.textContent = username;
        }
    }

    // ============================================
    // Initialize
    // ============================================
    function init() {
        setViewportHeight();
        setUserInfo();
        initEventListeners();
        
        console.log('SecureChat UI initialized');
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();