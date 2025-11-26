// Emoji Picker Handler using emoji-picker-element
let emojiPicker = null;
let isPickerOpen = false;

document.addEventListener('DOMContentLoaded', function() {
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPickerContainer = document.getElementById('emojiPickerContainer');
    const messageInput = document.getElementById('messageInput');
    
    const initializeEmojiPicker = () => {
        if (window.EmojiPicker) {
            setupEmojiPicker();
        } else {
            setTimeout(initializeEmojiPicker, 100);
        }
    };
    
    function setupEmojiPicker() {
        emojiPicker = new window.EmojiPicker({
            theme: 'dark',
            emojiSize: '1.4em',
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
        
        emojiPicker.classList.add('emoji-picker-dark');
        
        emojiPicker.addEventListener('emoji-click', (event) => {
            insertEmoji(event.detail.unicode);
        });
        
        if (emojiPickerContainer) {
            emojiPickerContainer.appendChild(emojiPicker);
        }
    }
    
    function insertEmoji(emoji) {
        if (!messageInput || messageInput.disabled) return;
        
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const text = messageInput.value;
        
        messageInput.value = text.substring(0, start) + emoji + text.substring(end);
        
        const newPosition = start + emoji.length;
        messageInput.setSelectionRange(newPosition, newPosition);
        messageInput.focus();
        
        const event = new Event('input', { bubbles: true });
        messageInput.dispatchEvent(event);
    }
    
    function toggleEmojiPicker() {
        if (!emojiPicker || !emojiPickerContainer) return;
        
        isPickerOpen = !isPickerOpen;
        
        if (isPickerOpen) {
            emojiPickerContainer.classList.add('sc-emoji-picker--active');
            emojiBtn.classList.add('sc-input-area__emoji-btn--active');
        } else {
            emojiPickerContainer.classList.remove('sc-emoji-picker--active');
            emojiBtn.classList.remove('sc-input-area__emoji-btn--active');
        }
    }
    
    function closeEmojiPicker(e) {
        if (isPickerOpen && 
            emojiPickerContainer &&
            emojiBtn &&
            !emojiPickerContainer.contains(e.target) && 
            !emojiBtn.contains(e.target)) {
            isPickerOpen = false;
            emojiPickerContainer.classList.remove('sc-emoji-picker--active');
            emojiBtn.classList.remove('sc-input-area__emoji-btn--active');
        }
    }
    
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleEmojiPicker();
        });
    }
    
    document.addEventListener('click', closeEmojiPicker);
    
    if (emojiPickerContainer) {
        emojiPickerContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPickerOpen) {
            isPickerOpen = false;
            emojiPickerContainer?.classList.remove('sc-emoji-picker--active');
            emojiBtn?.classList.remove('sc-input-area__emoji-btn--active');
        }
    });
    
    initializeEmojiPicker();
});