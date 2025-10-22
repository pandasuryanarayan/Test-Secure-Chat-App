// Auto-resize textarea functionality
document.addEventListener('DOMContentLoaded', function() {
    const textarea = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const messagesContainer = document.getElementById('messagesContainer');
    
    if (!textarea) return;

    // Calculate line height and padding
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = parseInt(computedStyle.lineHeight) || 20;
    const paddingTop = parseInt(computedStyle.paddingTop) || 12;
    const paddingBottom = parseInt(computedStyle.paddingBottom) || 12;
    const borderTop = parseInt(computedStyle.borderTopWidth) || 1;
    const borderBottom = parseInt(computedStyle.borderBottomWidth) || 1;
    
    // Initial height
    const minHeight = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
    
    // Set max lines based on screen size
    function getMaxLines() {
        return window.innerWidth <= 768 ? 4 : 5;
    }
    
    // Calculate max height based on lines
    function getMaxHeight() {
        const maxLines = getMaxLines();
        return (lineHeight * maxLines) + paddingTop + paddingBottom + borderTop + borderBottom;
    }
    
    // Auto-resize function
    function autoResize() {
        // Store current scroll position
        const currentScroll = messagesContainer ? messagesContainer.scrollTop : 0;
        const isAtBottom = messagesContainer ? 
            (messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 50) : false;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        textarea.style.overflowY = 'hidden';
        
        // Get the scroll height
        let newHeight = textarea.scrollHeight;
        const maxHeight = getMaxHeight();
        
        // Apply height with constraints
        if (newHeight < minHeight) {
            newHeight = minHeight;
        }
        
        if (newHeight > maxHeight) {
            newHeight = maxHeight;
            textarea.style.overflowY = 'auto';
        } else {
            textarea.style.overflowY = 'hidden';
        }
        
        // Set the new height with smooth transition
        textarea.style.height = newHeight + 'px';
        
        // Maintain scroll position
        if (messagesContainer) {
            if (isAtBottom) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } else {
                messagesContainer.scrollTop = currentScroll;
            }
        }
    }
    
    // Reset textarea to initial state
    function resetTextarea() {
        textarea.style.height = minHeight + 'px';
        textarea.style.overflowY = 'hidden';
        textarea.value = '';
        autoResize();
    }
    
    // Handle input event for auto-resize
    textarea.addEventListener('input', function() {
        autoResize();
    });
    
    // Handle paste event
    textarea.addEventListener('paste', function() {
        setTimeout(autoResize, 0);
    });
    
    // Handle cut event
    textarea.addEventListener('cut', function() {
        setTimeout(autoResize, 0);
    });
    
    // Fix the keydown event handler for proper Shift+Enter support
    textarea.addEventListener('keydown', function(e) {
        // Check if Enter key is pressed
        if (e.key === 'Enter' || e.keyCode === 13) {
            // If Shift is held, allow default behavior (new line)
            if (e.shiftKey) {
                // Let the default behavior happen (insert new line)
                setTimeout(autoResize, 0); // Resize after new line is added
                return; // Don't prevent default, allow new line
            } else {
                // Enter without Shift = send message
                e.preventDefault(); // Prevent new line
                
                // Only send if textarea has content and is enabled
                if (textarea.value.trim() && !textarea.disabled && !sendBtn.disabled) {
                    // Trigger send button click
                    sendBtn.click();
                }
            }
        }
    });
    
    // Handle window resize to recalculate max height
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            autoResize();
        }, 100);
    });
    
    // Initial setup
    textarea.style.height = minHeight + 'px';
    textarea.style.overflowY = 'hidden';
    autoResize();
    
    // Export reset function for use in chat.js
    window.resetTextareaHeight = resetTextarea;
});