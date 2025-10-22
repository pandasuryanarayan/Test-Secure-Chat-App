# SecureChat Client

This is the frontend client for SecureChat, a secure end-to-end encrypted messaging application. The client provides a modern, responsive interface for private messaging with strong encryption and privacy features.

## Features

- **End-to-End Encryption**: All messages are encrypted on the client side using AES-256 and RSA-2048
- **Dark Mode Interface**: Modern dark-themed UI optimized for readability and reduced eye strain
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Real-Time Messaging**: Instant message delivery with typing indicators
- **Emoji Support**: Full emoji picker with categories and search
- **Auto-Expanding Textarea**: Smooth text input that expands as you type
- **Online Status**: See when contacts are online or offline
- **Unique 6-Digit ID**: Connect with others using simple 6-digit IDs instead of phone numbers
- **Message Formatting**: Support for multi-line messages and emoji

## Tech Stack

- **Vanilla JavaScript**: No frameworks, just pure JavaScript for optimal performance
- **Socket.IO Client**: Real-time bidirectional communication
- **Web Crypto API**: For client-side encryption and decryption
- **CSS3**: Modern styling with CSS variables and flexbox/grid layouts
- **HTML5**: Semantic markup
- **Emoji Picker Element**: Lightweight emoji picker library

## Project Structure

```
client/
├── index.html            # Landing page
├── login.html            # Login/Register page
├── chat.html             # Main chat interface
├── css/
│   ├── index.css         # Landing page styles
│   ├── login.css         # Login page styles
│   └── chat-responsive.css # Chat interface styles
├── js/
│   ├── auth.js           # Authentication logic
│   ├── chat.js           # Main chat functionality
│   ├── encryption.js     # E2E encryption implementation
│   ├── textarea-resize.js # Auto-expanding textarea
│   └── emoji-picker-handler.js # Emoji picker integration
└── README.md             # This file
```

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- SecureChat server running (see server README)

### Installation

1. Clone the repository
2. Navigate to the client directory
3. No build process required - this is a vanilla JavaScript application

### Running the Client

The client should be served through the SecureChat server. When you run the server, it will automatically serve the client files.

Access the application at:
```
http://localhost:3000
```

## Usage Guide

### Registration and Login

1. Visit the landing page and click "Login"
2. Choose "Register" tab to create a new account
3. Enter username, email, and password
4. After registration, you'll receive a unique 6-digit ID
5. Share this ID with friends to connect

### Adding Contacts

1. In the chat interface, enter a 6-digit ID in the sidebar
2. Click "Connect" to add the contact
3. The contact will appear in your contacts list
4. Both users will see each other in their contacts list

### Messaging

1. Select a contact from the sidebar
2. Type your message in the input area
3. Press Enter to send or Shift+Enter for a new line
4. Use the emoji button to add emojis
5. Messages are delivered instantly when both users are online

### Security Features

- Messages are encrypted with AES-256 before sending
- Key exchange uses RSA-2048
- Messages cannot be sent to offline users
- No message history is stored on the server
- Perfect forward secrecy is maintained

## Responsive Design

The interface adapts to different screen sizes:

- **Desktop**: Full sidebar and chat view side by side
- **Tablet**: Narrower sidebar with optimized chat area
- **Mobile**: Slide-out sidebar with hamburger menu and optimized mobile layout
- **Small Mobile**: Further optimized for very small screens

## Customization

### Theme

The application uses CSS variables for theming. You can modify the colors in `chat-responsive.css`:

```css
:root {
    --bg-primary: #0a0a0a;
    --bg-secondary: #141414;
    --accent: #4a9eff;
    /* and more variables */
}
```

### Fonts

The application uses the Inter font family. You can change this by modifying the `--font-primary` variable.

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Development

### Adding New Features

1. Create feature branch: `git checkout -b feature/your-feature-name`
2. Implement your changes
3. Test thoroughly in different browsers and screen sizes
4. Create pull request

### Code Style

- Use ES6+ features
- Add comments for complex logic
- Follow the existing naming conventions
- Test on multiple devices and browsers

## Troubleshooting

### Common Issues

- **Connection Error**: Make sure the server is running on port 3000
- **Messages Not Sending**: Verify both users are online
- **Emoji Picker Not Working**: Check if your browser supports the Web Components API

### Browser Console

Check the browser console (F12) for any error messages or warnings.

## Privacy and Security

- No messages are stored on the server
- All encryption/decryption happens in the browser
- User IDs are randomly generated
- No tracking or analytics

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or use is strictly prohibited.

## Author

Developed by Surya