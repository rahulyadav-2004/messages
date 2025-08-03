// Firebase configuration and initialization
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, doc, setDoc, getDoc, onSnapshot, serverTimestamp, limit } from "firebase/firestore";
import { getDatabase, ref, onDisconnect, set, onValue } from "firebase/database";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, uploadBytesResumable } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBKDrVh9QW2R7wJLIpQ_685C8-VmQ9QZKU",
  authDomain: "unbiased-app-ae0e3.firebaseapp.com",
  projectId: "unbiased-app-ae0e3",
  storageBucket: "unbiased-app-ae0e3.firebasestorage.app",
  messagingSenderId: "177367961612",
  appId: "1:177367961612:web:e5a57dd952a29f596f9e29",
  measurementId: "G-G5E5C62F2H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

// Initialize Realtime Database for presence
export const rtdb = getDatabase(app);

// Initialize Analytics
export const analytics = getAnalytics(app);

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();

// Authentication helper functions
export const signInWithGoogle = () => {
  return signInWithPopup(auth, googleProvider);
};

export const signInWithEmail = (email, password) => {
  return signInWithEmailAndPassword(auth, email, password);
};

export const signUpWithEmail = (email, password) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

export const logOut = () => {
  return signOut(auth);
};

export const onAuthStateChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// User management functions with caching
let usersCache = null;
let usersCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const createUserProfile = async (user, additionalData = {}) => {
  if (!user) return;
  
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);
  
  if (!snapshot.exists()) {
    const { displayName, email, photoURL } = user;
    const createdAt = new Date();
    
    try {
      await setDoc(userRef, {
        displayName: displayName || additionalData.displayName || email?.split('@')[0],
        email,
        photoURL: photoURL || null,
        createdAt,
        lastActive: createdAt,
        isOnline: true,
        ...additionalData
      });
      
      // Clear cache when new user is created
      usersCache = null;
    } catch (error) {
      console.error('Error creating user profile:', error);
    }
  }
  
  return userRef;
};

export const getAllUsers = async () => {
  // Return cached data if it's still fresh
  if (usersCache && usersCacheTime && (Date.now() - usersCacheTime < CACHE_DURATION)) {
    return usersCache;
  }

  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Cache the results
    usersCache = users;
    usersCacheTime = Date.now();
    
    return users;
  } catch (error) {
    console.error('Error fetching users:', error);
    return usersCache || []; // Return cached data if available
  }
};

// Real-time users listener (more efficient than polling)
export const listenToUsers = (callback) => {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, orderBy('createdAt', 'desc'));
  
  return onSnapshot(q, (snapshot) => {
    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Update cache
    usersCache = users;
    usersCacheTime = Date.now();
    
    callback(users);
  }, (error) => {
    console.error('Error listening to users:', error);
    // Return cached data on error
    if (usersCache) {
      callback(usersCache);
    }
  });
};

export const updateUserOnlineStatus = async (userId, isOnline) => {
  try {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, {
      isOnline,
      lastActive: new Date()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

// Optimized messaging functions
export const createChatId = (userId1, userId2) => {
  // Create a consistent chat ID regardless of order
  return [userId1, userId2].sort().join('_');
};

// Message batching to reduce writes - improved for real-time updates
let messageBatch = [];
let batchTimeout = null;
const BATCH_DELAY = 100; // Reduced to 100ms for faster updates

export const sendMessage = async (senderId, receiverId, content) => {
  try {
    const chatId = createChatId(senderId, receiverId);
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    
    const messageData = {
      senderId,
      receiverId,
      content: content.trim(),
      timestamp: serverTimestamp(),
      read: false
    };

    // Send message first
    await addDoc(messagesRef, messageData);
    
    // Immediately update chat metadata for real-time visibility
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    const currentData = chatDoc.data() || {};
    const currentUnreadCount = currentData[`unreadCount_${receiverId}`] || 0;
    
    // Update chat metadata immediately
    await setDoc(chatRef, {
      participants: [senderId, receiverId],
      lastMessage: content.trim(),
      lastMessageTimestamp: serverTimestamp(),
      lastMessageSender: senderId,
      [`unreadCount_${receiverId}`]: currentUnreadCount + 1,
      // Reset sender's unread count if they had any
      [`unreadCount_${senderId}`]: 0
    }, { merge: true });

    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
};

// File upload functions
export const uploadFile = async (file, senderId, receiverId, onProgress) => {
  try {
    console.log('Starting file upload:', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId,
      receiverId
    });

    const chatId = createChatId(senderId, receiverId);
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileRef = storageRef(storage, `chats/${chatId}/${fileName}`);
    
    console.log('Upload path:', `chats/${chatId}/${fileName}`);
    
    // Upload with progress tracking
    const uploadTask = uploadBytesResumable(fileRef, file);
    
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('Upload progress:', progress);
          if (onProgress) onProgress(progress);
        },
        (error) => {
          console.error('Upload error details:', {
            code: error.code,
            message: error.message,
            name: error.name,
            serverResponse: error.serverResponse
          });
          reject(error);
        },
        async () => {
          try {
            console.log('Upload completed, getting download URL...');
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log('Download URL obtained:', downloadURL);
            resolve({
              url: downloadURL,
              name: file.name,
              size: file.size,
              type: file.type
            });
          } catch (error) {
            console.error('Error getting download URL:', error);
            reject(error);
          }
        }
      );
    });
  } catch (error) {
    console.error('Error in uploadFile function:', error);
    throw error;
  }
};

export const sendMediaMessage = async (senderId, receiverId, fileInfo, messageType = 'image') => {
  try {
    console.log('Sending media message:', {
      senderId,
      receiverId,
      fileInfo,
      messageType
    });

    const chatId = createChatId(senderId, receiverId);
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    
    const messageData = {
      senderId,
      receiverId,
      type: messageType, // 'image', 'video', 'file'
      mediaUrl: fileInfo.url,
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      fileType: fileInfo.type,
      timestamp: serverTimestamp(),
      read: false
    };

    console.log('Message data:', messageData);

    // Send media message
    await addDoc(messagesRef, messageData);
    console.log('Media message added to Firestore');
    
    // Update chat metadata
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    const currentData = chatDoc.data() || {};
    const currentUnreadCount = currentData[`unreadCount_${receiverId}`] || 0;
    
    // Determine last message preview based on type
    let lastMessagePreview = '';
    switch (messageType) {
      case 'image':
        lastMessagePreview = '📷 Photo';
        break;
      case 'video':
        lastMessagePreview = '🎥 Video';
        break;
      default:
        lastMessagePreview = `📎 ${fileInfo.name}`;
    }
    
    // Update chat metadata
    await setDoc(chatRef, {
      participants: [senderId, receiverId],
      lastMessage: lastMessagePreview,
      lastMessageTimestamp: serverTimestamp(),
      lastMessageSender: senderId,
      [`unreadCount_${receiverId}`]: currentUnreadCount + 1,
      [`unreadCount_${senderId}`]: 0
    }, { merge: true });

    console.log('Chat metadata updated successfully');
    return true;
  } catch (error) {
    console.error('Error sending media message:', {
      error: error,
      code: error.code,
      message: error.message
    });
    return false;
  }
};

// Utility function to determine message type from file
export const getMessageType = (file) => {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'file';
};

// Utility function to format file size
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Mark messages as read and reset unread count
export const markChatAsRead = async (chatId, userId) => {
  try {
    // Reset unread count for this user immediately
    const chatRef = doc(db, 'chats', chatId);
    await setDoc(chatRef, { [`unreadCount_${userId}`]: 0 }, { merge: true });
    
    // Mark individual messages as read (can be done in background)
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef, 
      where('receiverId', '==', userId),
      where('read', '==', false)
    );
    
    const snapshot = await getDocs(q);
    
    const updatePromises = snapshot.docs.map(doc => 
      setDoc(doc.ref, { read: true }, { merge: true })
    );
    
    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error marking chat as read:', error);
  }
};

// Get user chats with unread counts - enhanced for better real-time updates
export const getUserChatsWithCounts = (userId, callback) => {
  const chatsRef = collection(db, 'chats');
  const q = query(
    chatsRef,
    where('participants', 'array-contains', userId)
  );
  
  return onSnapshot(q, (snapshot) => {
    const chats = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        unreadCount: data[`unreadCount_${userId}`] || 0
      };
    }).sort((a, b) => {
      // Sort by last message timestamp descending
      if (!a.lastMessageTimestamp && !b.lastMessageTimestamp) return 0;
      if (!a.lastMessageTimestamp) return 1;
      if (!b.lastMessageTimestamp) return -1;
      
      const aTime = a.lastMessageTimestamp.toDate ? a.lastMessageTimestamp.toDate() : new Date(a.lastMessageTimestamp);
      const bTime = b.lastMessageTimestamp.toDate ? b.lastMessageTimestamp.toDate() : new Date(b.lastMessageTimestamp);
      return bTime - aTime;
    });
    callback(chats);
  }, (error) => {
    console.error('Error listening to user chats:', error);
  });
};

// Paginated message loading
export const getChatMessages = (userId1, userId2, callback, limitCount = 50) => {
  const chatId = createChatId(userId1, userId2);
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(
    messagesRef, 
    orderBy('timestamp', 'desc'), 
    limit(limitCount)
  );
  
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })).reverse(); // Reverse to show oldest first
    callback(messages);
  });
};

// Load older messages (pagination)
export const loadOlderMessages = async (userId1, userId2, lastMessage, limitCount = 20) => {
  const chatId = createChatId(userId1, userId2);
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(
    messagesRef,
    orderBy('timestamp', 'desc'),
    where('timestamp', '<', lastMessage.timestamp),
    limit(limitCount)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })).reverse();
};

export const markMessagesAsRead = async (chatId, userId) => {
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef, 
      where('receiverId', '==', userId),
      where('read', '==', false)
    );
    
    const snapshot = await getDocs(q);
    
    const updatePromises = snapshot.docs.map(doc => 
      setDoc(doc.ref, { read: true }, { merge: true })
    );
    
    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
};

export const getUserChats = (userId, callback) => {
  const chatsRef = collection(db, 'chats');
  const q = query(
    chatsRef,
    where('participants', 'array-contains', userId),
    orderBy('lastMessageTimestamp', 'desc')
  );
  
  return onSnapshot(q, (snapshot) => {
    const chats = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(chats);
  });
};

// Optimized presence system
export const initializePresence = (userId) => {
  const userStatusRef = ref(rtdb, `/status/${userId}`);
  const isOnlineForDatabase = {
    state: 'online',
    last_changed: serverTimestamp(),
  };

  const isOfflineForDatabase = {
    state: 'offline',
    last_changed: serverTimestamp(),
  };

  // Set user online
  set(userStatusRef, isOnlineForDatabase);

  // Set user offline when they disconnect
  onDisconnect(userStatusRef).set(isOfflineForDatabase);
};

export const listenToUserPresence = (userIds, callback) => {
  const presenceData = {};
  
  userIds.forEach(userId => {
    const userStatusRef = ref(rtdb, `/status/${userId}`);
    onValue(userStatusRef, (snapshot) => {
      const status = snapshot.val();
      presenceData[userId] = status?.state === 'online';
      callback(presenceData);
    });
  });
};

export default app;
