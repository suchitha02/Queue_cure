require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { registerSocketHandlers } = require('./socket/handlers');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

// REST: get today's session stats (for initial load / refresh fallback)
app.get('/api/session/today', async (req, res) => {
  try {
    const { getTodaySession, buildSnapshot } = require('./socket/handlers');
    const session = await getTodaySession();
    res.json(buildSnapshot(session));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register all socket events
registerSocketHandlers(io);

// Connect to MongoDB then start server
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/queuecure';


mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB connected`);
    server.listen(PORT, () => {
      console.log(`🚀 Queue Cure backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });
