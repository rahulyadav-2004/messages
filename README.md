# React Chat Application with Firebase

A modern, real-time chat application built with React and Firebase, featuring user authentication, real-time messaging, file sharing, presence indicators, and unread message tracking.

## 🚀 Features

### Core Features
- **Real-time Messaging**: Instant message delivery using Firebase Firestore
- **User Authentication**: Firebase Auth with email/password
- **File Sharing**: Upload and share images, videos, and files
- **Online Presence**: Real-time user online/offline status
- **Unread Message Tracking**: Smart unread count with badges
- **Responsive Design**: Mobile-friendly interface with collapsible sidebar
- **Message Status**: Read receipts and delivery status
- **User Management**: Automatic user creation and profile management

### Advanced Features
- **Smart Chat Sorting**: Prioritizes unread messages and recent conversations
- **Media Preview**: Image/video preview before sending
- **File Type Detection**: Automatic file type recognition and handling
- **Upload Progress**: Real-time upload progress indicators
- **Error Handling**: Comprehensive error handling for all operations
- **Performance Optimization**: Efficient data fetching with real-time listeners

## 🏗️ Architecture Overview

### Frontend Architecture
```
src/
├── Components/
│   ├── Auth.jsx              # Authentication component
│   ├── Messages.jsx          # Main chat interface
│   └── ProtectedRoute.js     # Route protection component
├── contexts/
│   └── AuthContext.js        # Authentication context provider
└── firebase/
    └── config.js            # Firebase configuration and utilities
```

### Backend Architecture (Firebase)
- **Firestore**: Document-based NoSQL database for messages and user data
- **Firebase Auth**: User authentication and session management
- **Firebase Storage**: File upload and media storage
- **Realtime Database**: User presence and online status tracking

## 📊 Database Schema

### Firestore Collections

#### 1. Users Collection (`users`)
```javascript
{
  id: "userId",              // Document ID (matches Auth UID)
  email: "user@example.com", // User email
  displayName: "John Doe",   // User display name
  photoURL: "https://...",   // Profile picture URL (optional)
  createdAt: Timestamp,      // Account creation timestamp
  lastActive: Timestamp      // Last activity timestamp
}
```

#### 2. Messages Collection (`messages`)
```javascript
{
  id: "messageId",           // Auto-generated document ID
  senderId: "userId",        // Sender's user ID
  receiverId: "userId",      // Receiver's user ID
  content: "Hello world",    // Message text content
  type: "text",              // Message type: "text", "image", "video", "file"
  timestamp: Timestamp,      // Message creation time
  
  // Media fields (for non-text messages)
  mediaUrl: "https://...",   // Firebase Storage URL
  fileName: "image.jpg",     // Original file name
  fileSize: 1024,           // File size in bytes
  
  // Chat metadata
  chatId: "user1_user2",    // Composite chat identifier
  read: false               // Read status
}
```

#### 3. Chats Collection (`chats`)
```javascript
{
  id: "chatId",                    // Format: "userId1_userId2" (sorted)
  participants: ["user1", "user2"], // Array of participant user IDs
  lastMessage: "Hello there",       // Last message content
  lastMessageTimestamp: Timestamp,  // Last message time
  lastMessageSenderId: "userId",   // Who sent the last message
  
  // Unread counts per user
  unreadCounts: {
    "user1": 0,                    // Unread count for user1
    "user2": 3                     // Unread count for user2
  }
}
```

### Realtime Database Schema (`presence`)
```javascript
{
  users: {
    "userId": {
      online: true,              // Online status
      lastSeen: "2025-01-09T10:30:00Z"  // Last seen timestamp
    }
  }
}
```

### Firebase Storage Structure
```
chats/
├── userId1_userId2/           # Chat-specific folder
│   ├── messageId1_filename.jpg
│   ├── messageId2_video.mp4
│   └── messageId3_document.pdf
└── userId3_userId4/
    └── messageId4_image.png
```

## 🔧 Core Backend Logic

### 1. Authentication Flow
```javascript
// User registration/login
const signUp = async (email, password, displayName) => {
  // 1. Create Firebase Auth user
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  
  // 2. Update profile with display name
  await updateProfile(userCredential.user, { displayName });
  
  // 3. Create user document in Firestore
  await setDoc(doc(db, 'users', userCredential.user.uid), {
    email,
    displayName,
    createdAt: serverTimestamp(),
    lastActive: serverTimestamp()
  });
  
  return userCredential.user;
};
```

### 2. Real-time Messaging System
```javascript
// Send message with automatic chat creation
const sendMessage = async (senderId, receiverId, content) => {
  const chatId = createChatId(senderId, receiverId);
  const messageRef = doc(collection(db, 'messages'));
  
  // Create message document
  await setDoc(messageRef, {
    senderId,
    receiverId,
    content,
    type: 'text',
    timestamp: serverTimestamp(),
    chatId,
    read: false
  });
  
  // Update or create chat document
  const chatRef = doc(db, 'chats', chatId);
  await setDoc(chatRef, {
    participants: [senderId, receiverId],
    lastMessage: content,
    lastMessageTimestamp: serverTimestamp(),
    lastMessageSenderId: senderId,
    unreadCounts: {
      [senderId]: 0,
      [receiverId]: increment(1)  // Increment unread count for receiver
    }
  }, { merge: true });
};
```

### 3. File Upload System
```javascript
const uploadFile = async (file, senderId, receiverId, onProgress) => {
  const chatId = createChatId(senderId, receiverId);
  const messageId = doc(collection(db, 'messages')).id;
  const fileName = `${messageId}_${file.name}`;
  const storageRef = ref(storage, `chats/${chatId}/${fileName}`);
  
  // Upload with progress tracking
  const uploadTask = uploadBytesResumable(storageRef, file);
  
  return new Promise((resolve, reject) => {
    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress(progress);
      },
      (error) => reject(error),
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({
          url: downloadURL,
          fileName: file.name,
          fileSize: file.size,
          messageId
        });
      }
    );
  });
};
```

### 4. Presence System
```javascript
// Initialize user presence
const initializePresence = (userId) => {
  const userPresenceRef = ref(rtdb, `users/${userId}`);
  
  // Set user online
  set(userPresenceRef, {
    online: true,
    lastSeen: new Date().toISOString()
  });
  
  // Set offline on disconnect
  onDisconnect(userPresenceRef).set({
    online: false,
    lastSeen: new Date().toISOString()
  });
};

// Listen to presence changes
const listenToUserPresence = (userIds, callback) => {
  const unsubscribers = userIds.map(userId => {
    const presenceRef = ref(rtdb, `users/${userId}`);
    return onValue(presenceRef, (snapshot) => {
      const presence = snapshot.val();
      callback(prevState => ({
        ...prevState,
        [userId]: presence?.online || false
      }));
    });
  });
  
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
};
```

### 5. Unread Message Tracking
```javascript
// Mark chat as read
const markChatAsRead = async (chatId, userId) => {
  const chatRef = doc(db, 'chats', chatId);
  
  // Reset unread count for current user
  await updateDoc(chatRef, {
    [`unreadCounts.${userId}`]: 0
  });
  
  // Mark all messages as read
  const messagesQuery = query(
    collection(db, 'messages'),
    where('chatId', '==', chatId),
    where('receiverId', '==', userId),
    where('read', '==', false)
  );
  
  const snapshot = await getDocs(messagesQuery);
  const batch = writeBatch(db);
  
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { read: true });
  });
  
  await batch.commit();
};
```

### 6. Smart Chat Sorting Algorithm
```javascript
// Sort users by activity and unread status
const sortUsers = (users, selectedChat, isActivelyChatting) => {
  return users.sort((a, b) => {
    const isASelected = a.id === selectedChat;
    const isBSelected = b.id === selectedChat;
    
    // Prioritize selected chat during active conversation
    if (isActivelyChatting) {
      if (isASelected && !isBSelected) return -1;
      if (isBSelected && !isASelected) return 1;
    }
    
    // Priority 1: Unread messages
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
    
    // Priority 2: Recent messages
    if (a.lastMessageTime && b.lastMessageTime) {
      return b.lastMessageTime - a.lastMessageTime;
    }
    
    // Priority 3: Online status
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    
    // Priority 4: Account creation time
    return b.createdAt - a.createdAt;
  });
};
```

## 🛠️ Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Firebase account

### 1. Clone the Repository
```bash
git clone <repository-url>
cd chat
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Firebase Configuration

#### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Authentication, Firestore, Storage, and Realtime Database

#### Configure Authentication
1. Go to Authentication > Sign-in method
2. Enable Email/Password provider

#### Set up Firestore
1. Go to Firestore Database
2. Create database in production mode
3. Set up security rules:

```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read all users but only write their own
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Messages - users can only read/write messages they're involved in
    match /messages/{messageId} {
      allow read, write: if request.auth != null && 
        (request.auth.uid == resource.data.senderId || 
         request.auth.uid == resource.data.receiverId);
    }
    
    // Chats - users can only access chats they participate in
    match /chats/{chatId} {
      allow read, write: if request.auth != null && 
        request.auth.uid in resource.data.participants;
    }
  }
}
```

#### Set up Storage
1. Go to Storage
2. Set up security rules:

```javascript
// Storage Security Rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /chats/{chatId}/{fileName} {
      allow read, write: if request.auth != null;
    }
  }
}
```

#### Set up Realtime Database
1. Go to Realtime Database
2. Create database
3. Set up security rules:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": true,
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

### 4. Environment Configuration
Create `.env` file in the root directory:

```env
REACT_APP_FIREBASE_API_KEY=your-api-key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
REACT_APP_FIREBASE_APP_ID=your-app-id
REACT_APP_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com/
```

### 5. Deploy Storage Rules
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize project
firebase init storage

# Deploy storage rules
firebase deploy --only storage
```

### 6. Run the Application
```bash
npm start
```

The application will be available at `http://localhost:3000`.

## 🎨 UI/UX Features

### Responsive Design
- **Desktop**: Full sidebar with user list and chat area
- **Tablet**: Collapsible sidebar for better space utilization
- **Mobile**: Compact header with floating contact avatars

### Visual Indicators
- **Online Status**: Green dots for online users
- **Unread Messages**: Blue badges with count
- **Message Status**: Read receipts and delivery indicators
- **Upload Progress**: Real-time progress bars

### Accessibility
- Keyboard navigation support
- Screen reader friendly
- High contrast color scheme
- Proper ARIA labels

## 📱 Mobile Optimization

### Features
- Touch-friendly interface
- Swipe gestures support
- Optimized for small screens
- Fast loading and smooth animations

### Performance
- Lazy loading of messages
- Efficient re-rendering with React.memo
- Optimized image loading
- Minimal bundle size

## 🔒 Security Considerations

### Data Protection
- All sensitive data encrypted in transit
- Firestore security rules prevent unauthorized access
- File uploads restricted to authenticated users
- XSS protection with proper input sanitization

### Authentication
- Secure password requirements
- Session management with Firebase Auth
- Automatic token refresh
- Logout on tab close

## 🚀 Performance Optimizations

### Frontend
- React.memo for component optimization
- useMemo and useCallback for expensive operations
- Efficient state management
- Code splitting and lazy loading

### Backend
- Firestore compound queries for efficient data retrieval
- Real-time listeners with proper cleanup
- Batch operations for multiple updates
- Optimistic UI updates

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### E2E Tests
```bash
npm run test:e2e
```

## 📦 Deployment

### Build for Production
```bash
npm run build
```

### Deploy to Firebase Hosting
```bash
firebase deploy --only hosting
```

### Deploy to Vercel
```bash
vercel --prod
```

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REACT_APP_FIREBASE_API_KEY` | Firebase API Key | Yes |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | Yes |
| `REACT_APP_FIREBASE_PROJECT_ID` | Firebase Project ID | Yes |
| `REACT_APP_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket | Yes |
| `REACT_APP_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID | Yes |
| `REACT_APP_FIREBASE_APP_ID` | Firebase App ID | Yes |
| `REACT_APP_FIREBASE_DATABASE_URL` | Realtime Database URL | Yes |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Troubleshooting

### Common Issues

#### Firebase Storage Upload Fails
**Problem**: Files cannot be uploaded
**Solution**: Ensure Firebase Storage rules are deployed:
```bash
firebase deploy --only storage
```

#### Messages Not Appearing in Real-time
**Problem**: Messages don't show immediately
**Solution**: Check Firestore security rules and ensure proper authentication

#### Presence Status Not Updating
**Problem**: Online/offline status not working
**Solution**: Verify Realtime Database rules and connection

#### Build Fails
**Problem**: Production build errors
**Solution**: Check all environment variables are properly set

### Debug Mode
Enable debug mode by adding to `.env`:
```env
REACT_APP_DEBUG=true
```

## 📞 Support

For support, email support@yourapp.com or join our Slack channel.

---

**Built with ❤️ using React and Firebase**
