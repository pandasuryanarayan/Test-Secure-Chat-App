// Emoji Picker Handler using emoji-picker-element
let emojiPicker = null;
let isPickerOpen = false;

document.addEventListener('DOMContentLoaded', function() {
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPickerContainer = document.getElementById('emojiPickerContainer');
    const messageInput = document.getElementById('messageInput');
    
    // Wait for EmojiPicker to be available
    const initializeEmojiPicker = () => {
        if (window.EmojiPicker) {
            setupEmojiPicker();
        } else {
            setTimeout(initializeEmojiPicker, 100);
        }
    };
    
    function setupEmojiPicker() {
        // Create emoji picker instance with dark theme
        emojiPicker = new window.EmojiPicker({
            theme: 'dark',
            emojiSize: '1.3em',
            showPreview: false,
            showVariants: true,
            showRecents: true,
            emojiVersion: '14.0',
            maxRecents: 30,
            gridColumns: 8,
            categories: [
                'smileys-emotion',
                'people-body',
                'animals-nature',
                'food-drink',
                'travel-places',
                'activities',
                'objects',
                'symbols',
                'flags'
            ]
        });
        
        // Apply custom dark theme styles
        emojiPicker.classList.add('emoji-picker-dark');
        
        // Handle emoji selection
        emojiPicker.addEventListener('emoji-click', (event) => {
            insertEmoji(event.detail.unicode);
        });
        
        // Add picker to container
        emojiPickerContainer.appendChild(emojiPicker);
    }
    
    // Insert emoji at cursor position
    function insertEmoji(emoji) {
        if (!messageInput || messageInput.disabled) return;
        
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const text = messageInput.value;
        
        // Insert emoji at cursor position
        messageInput.value = text.substring(0, start) + emoji + text.substring(end);
        
        // Set cursor position after emoji
        const newPosition = start + emoji.length;
        messageInput.setSelectionRange(newPosition, newPosition);
        
        // Focus back to input
        messageInput.focus();
        
        // Trigger input event for auto-resize
        const event = new Event('input', { bubbles: true });
        messageInput.dispatchEvent(event);
        
        // Don't close picker on emoji selection for better UX
        // Users can select multiple emojis
    }
    
    // Toggle emoji picker
    function toggleEmojiPicker() {
        if (!emojiPicker) return;
        
        isPickerOpen = !isPickerOpen;
        
        if (isPickerOpen) {
            emojiPickerContainer.classList.add('active');
            emojiBtn.classList.add('active');
            
            // Position the picker
            positionPicker();
        } else {
            emojiPickerContainer.classList.remove('active');
            emojiBtn.classList.remove('active');
        }
    }
    
    // Position picker based on available space
    function positionPicker() {
        const btnRect = emojiBtn.getBoundingClientRect();
        const containerHeight = emojiPickerContainer.offsetHeight;
        const windowHeight = window.innerHeight;
        
        // Check if there's enough space above the button
        if (btnRect.top > containerHeight + 10) {
            // Position above
            emojiPickerContainer.style.bottom = '60px';
            emojiPickerContainer.style.top = 'auto';
        } else {
            // Position to the side or adjust
            emojiPickerContainer.style.bottom = 'auto';
            emojiPickerContainer.style.top = '60px';
        }
    }
    
    // Close emoji picker when clicking outside
    function closeEmojiPicker(e) {
        if (isPickerOpen && 
            !emojiPickerContainer.contains(e.target) && 
            !emojiBtn.contains(e.target)) {
            isPickerOpen = false;
            emojiPickerContainer.classList.remove('active');
            emojiBtn.classList.remove('active');
        }
    }
    
    // Event listeners
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleEmojiPicker();
        });
    }
    
    // Close picker when clicking outside
    document.addEventListener('click', closeEmojiPicker);
    
    // Prevent closing when clicking inside picker
    if (emojiPickerContainer) {
        emojiPickerContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // Close picker on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPickerOpen) {
            isPickerOpen = false;
            emojiPickerContainer.classList.remove('active');
            emojiBtn.classList.remove('active');
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (isPickerOpen) {
            positionPicker();
        }
    });
    
    // Initialize emoji picker
    initializeEmojiPicker();
});

// Enable/disable emoji button when chat is selected
window.addEventListener('DOMContentLoaded', () => {
    const originalUpdateMessageControls = window.updateMessageControls;
    
    window.updateMessageControls = function() {
        if (originalUpdateMessageControls) {
            originalUpdateMessageControls();
        }
        
        const emojiBtn = document.getElementById('emojiBtn');
        const messageInput = document.getElementById('messageInput');
        
        if (emojiBtn && messageInput) {
            emojiBtn.disabled = messageInput.disabled;
        }
    };
});