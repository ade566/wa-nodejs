const { Client } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
require('dotenv').config();
const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.get('/', (req, res) => {
  res.sendFile('scan.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './sessions-main/whatsapp-sessions.json';

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully');
    } catch (err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function (id) {
  console.log('Creating session: ' + id);
  const SESSION_FILE_PATH = `./sessions/whatsapp-session-${id}.json`;
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }
  const client = new Client({
    session: sessionCfg,
    restartOnAuthFail: true, // related problem solution
    puppeteer: {
      headless: true,
      args: ['--no-sandbox']
    } 
  });
  client.initialize();

  client.on('qr', (qr) => {
    console.log(`request QR: ${id}`);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', (session) => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });

    sessionCfg = session;
    console.log(`ready: ${id}`);
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
      if (err) {
        console.error(err);
      }
    });
  });

  client.on('auth_failure', function (session) {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    try {
      fs.unlinkSync(SESSION_FILE_PATH, function (err) {
        if (err) return console.log(err);
        console.log('Session file deleted!');
      });
    } catch (error) {
      
    }

    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    // savedSessions[sessionIndex].ready = false;
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
    const SESSION_FILE_HISTORY = `./history/history.json`;
      try {
        fs.writeFileSync(SESSION_FILE_HISTORY, JSON.stringify([]));
        console.log('Sessions file created successfully');
      } catch (err) {
        console.log('Failed to create sessions file: ', err);
      }
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function (socket) {
  init(socket);

  socket.on('create-session', function (data) {
    console.log('Create session: ' + data.id);
    createSession(data.id);
  });
});

// Send message
app.post('/send-message', (req, res) => {
  const sender = req.body.sender;
  const number = req.body.number + '@c.us';
  const message = req.body.message;
  try {
    const client = sessions.find(sess => sess.id == sender).client;
    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        response: response,
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      response: error,
    });
  }
});

// logout
app.get('/logout', (req, res) => {
  const client = sessions.find(sess => sess.id == req.query.id).client;
  client.logout().then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
  
});

server.listen(port, function () {
  console.log(`http://localhost:${port}/?id=123&as=Ares`);
});
