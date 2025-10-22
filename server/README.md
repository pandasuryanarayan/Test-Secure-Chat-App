# SecureChat Server

This is the backend server for SecureChat, a secure end-to-end encrypted messaging application. The server handles user authentication, real-time messaging, and secure key exchange while ensuring user privacy.

## Features

- **End-to-End Encryption**: Messages are encrypted on the client side and can only be decrypted by the intended recipient
- **User Authentication**: Secure login and registration with JWT tokens
- **Real-Time Messaging**: Instant message delivery using Socket.IO
- **Unique User IDs**: Each user gets a unique 6-digit ID for easy connection
- **Zero Knowledge Architecture**: Server cannot read message contents
- **In-Memory Message Buffering**: Temporary storage of messages for offline users
- **Online Status Tracking**: Real-time user online/offline status

## Tech Stack

- **Node.js**: JavaScript runtime
- **Express**: Web framework
- **Socket.IO**: Real-time bidirectional communication
- **MongoDB**: Database for user information
- **Mongoose**: MongoDB object modeling
- **JWT**: JSON Web Tokens for authentication
- **bcrypt**: Password hashing

## Project Structure

```
server/
├── index.js              # Main server file
├── models/
│   └── User.js           # User model schema
├── middleware/
│   └── auth.js           # Authentication middleware
├── .env                  # Environment variables (create this)
├── README.md 
└── package.json          # Dependencies and scripts
```

## Installation

1. Make sure you have Node.js (v14+) and MongoDB installed
2. Clone the repository
3. Navigate to the server directory
4. Install dependencies:

```bash
npm install
```

5. Create a `.env` file with the following variables:

```
MONGODB_URI=mongodb://localhost:27017/securechat
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
PORT=3000
```

## Running the Server

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## API Endpoints

### Authentication

- **POST /api/register**: Register a new user
  - Body: `{ email, password, username }`
  - Returns: `{ token, userId, username }`

- **POST /api/login**: Login existing user
  - Body: `{ email, password }`
  - Returns: `{ token, userId, username }`

- **POST /api/logout**: Logout user (requires auth)
  - Updates user's online status to false

### Users

- **GET /api/user/:userId**: Get user by ID (requires auth)
  - Returns: User object without sensitive data

- **GET /api/me**: Get current user info (requires auth)
  - Returns: Current user object

- **GET /api/contacts**: Get user's contacts (requires auth)
  - Returns: Array of contacts

### Test

- **GET /api/test**: Test if API is working
  - Returns: "API is working!"

## Socket.IO Events

### Client to Server

- **join**: User joins with their ID and username
- **contact-added**: Notify when a user adds another as contact
- **key-exchange**: Handle E2E encryption key exchange
- **encrypted-message**: Send encrypted message to recipient
- **typing**: Indicate user is typing
- **request-pending-messages**: Request any pending messages
- **get-pending-messages**: Get pending messages for specific chat

### Server to Client

- **user-online**: Notify when a user comes online
- **user-offline**: Notify when a user goes offline
- **contact-added**: Notify when someone adds you as contact
- **key-exchange**: Send encryption keys
- **receive-message**: Deliver encrypted message
- **user-typing**: Indicate when someone is typing
- **pending-messages**: Deliver pending messages

## Security Features

- **Password Hashing**: All passwords are hashed using bcrypt
- **JWT Authentication**: Secure token-based authentication
- **No Message Storage**: Messages are only temporarily buffered in memory
- **E2E Encryption**: Server never has access to decryption keys
- **CORS Protection**: Configured for secure cross-origin requests

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| MONGODB_URI | MongoDB connection string | mongodb://localhost:27017/securechat |
| JWT_SECRET | Secret key for JWT signing | your-secret-key |
| PORT | Server port | 3000 |

## Development

### Adding New Features

1. Create feature branch: `git checkout -b feature/your-feature-name`
2. Implement your changes
3. Test thoroughly
4. Create pull request

### Code Style

- Follow ESLint configuration
- Use async/await for asynchronous operations
- Add comments for complex logic

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or use is strictly prohibited.

## Author

Developed by Surya