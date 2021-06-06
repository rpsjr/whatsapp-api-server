const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const port = process.env.PORT || 8000;
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  allowEIO3: true // false by default
});

const cookieSession = require("cookie-session");
const crypto = require('crypto');

const getHashed = (text) => {
    const sha256 = crypto.createHash('sha256');
    const hash = sha256.update(text).digest('base64');
    return hash;
}

const users = [
    {
        username: 'KtinBJ18VRGsJU9fUf5woEbr2IRykFbw/lf1Fg1GcVM=',
        password: 'G906xRneIs5zNfwYmBXLXATbWzfbmLjLp6EOibUnW+8='
    }
];

// cookie session
app.use(
  cookieSession({
    keys: ["itKeySession"+"8106nowIJOy8iC0lvRcLXDZdOiuHSJEwG6rwAG375m4="],
  })
);
app.use(express.json({limit: '5mb'}));
app.use(express.urlencoded({
  limit: '5mb',
  extended: true
}));
app.use(fileUpload({
  debug: true
}));

app.get('/', (req, res) => {
  if (!req.session.user) {
    res.redirect('/login')
    return;
  } else {
    res.sendFile('index.html', {
      root: __dirname
    });
    return;
  }
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    res.redirect('/')
    return;
  } else {
    res.sendFile('login.html', {
      root: __dirname
    });
  }
});

app.get("/auth", (req, res) => {
  if (req.session.user) {
    res.redirect('/')
    return;
  } else {
    res.sendFile('auth_access.html', {
      root: __dirname
    });
  }
});
app.get("/validasi-auth", (req, res) => {
  if (req.session.user) {
    res.redirect('/')
    return;
  } else {
    res.sendFile('auth_validation.html', {
      root: __dirname
    });
  }
});

// post login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const hashedUsername = getHashed(username);
  const hashedPassword = getHashed(password);
  const user = users.find(u => {
      return hashedUsername === u.username && hashedPassword === u.password
  });
  if (user) {
      req.session.user = {
        username,
      };
      res.redirect('/');
  } else {
      res.redirect('/validasi-auth');
  }
  res.end();
});

//logout
app.get("/logout", async (req, res) => {
  req.session.user = null;
  res.redirect("/login");
});


const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
  const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }

  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: sessionCfg
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
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
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function(err) {
      if (err) {
        console.error(err);
      }
    });
  });

  client.on('auth_failure', function(session) {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    fs.unlinkSync(SESSION_FILE_PATH, function(err) {
        if(err) return console.log(err);
        console.log('Session file deleted!');
    });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });


  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}


const disconnectedSession = function(id) {
  console.log('Disconnected session: ' + id);
  const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
  console.log('SESSION_FILE_PATH: ' + SESSION_FILE_PATH);
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }

  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: sessionCfg
  });

  if (sessionCfg) {
    fs.unlinkSync(SESSION_FILE_PATH, function(err) {
      if(err) return console.log(err);
      console.log('Session file deleted!');
    });
    client.destroy();
    client.initialize();
  }
  // Menghapus pada file sessions
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
  savedSessions.splice(sessionIndex, 1);
  setSessionsFile(savedSessions);

  io.emit('remove-session', id);
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
      
      socket.on('disconnected-session', function(data) {
        console.log('Disconnected session: ' + data.id);
        disconnectedSession(data.id);
      });
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });

  // socket.on('disconnected-session', function(data) {
  //   console.log('Disconnected session: ' + data.id);
  //   disconnectedSession(data.id);
  // });

});


// Send message
app.post('/send-message', [
  body('sender').notEmpty(),
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      code: 422,
      message: errors.mapped()
    });
  }

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  // Cek Session / Koneksi WA
  const id = sender
  const path_session_file = `./whatsapp-session-${id}.json`;
  let session_wa;
  if (fs.existsSync(path_session_file)) {
    session_wa = require(path_session_file);
  }

  if (!session_wa) {
    error = {
      sender: sender,
      status: false,
      code: 404,
      message: 'Unauthenticated Client'
    }
    console.log(error);
    return res.status(404).json(error);
  }

  const client = sessions.find(sess => sess.id == sender).client;

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    error = {
      status: false,
      code: 422,
      message: 'The number is not registered'
    }
    console.log(error);
    return res.status(422).json(error);
  }

  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      code: 200,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      code: 500,
      response: err
    });
  });
});


// Send media
app.post('/send-media', [
  body('sender').notEmpty(),
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  const file = req.body.file;
  const filename = req.body.filename;
  const document = req.body.document;
  
  const get_ext = filename.split(".");
  const ext = get_ext[get_ext.length - 1];

  if (document) {
      mimetype = 'application/'+ext
  } else {
      mimetype = 'image/'+ext
  }

  media = new MessageMedia(mimetype, file, filename);

  // const fileurl = req.body.fileurl;
  // const filedirectory = req.body.filedirectory;

  // const media = MessageMedia.fromFilePath(filedirectory);
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  
  // let media;
  // if (fileurl) {
  //     console.log("fileurl", fileurl);
  //     let mimetype;
  //     const attachment = await axios.get(fileurl, {
  //       responseType: 'arraybuffer'
  //     }).then(response => {
  //       mimetype = response.headers['content-type'];
  //       return response.data.toString('base64');
  //     });
  //     console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
  //     console.log(attachment);
  //     console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
  //     media = new MessageMedia(mimetype, attachment, 'Media');
  // } else if (filedirectory) {
  //     console.log("filedirectory", filedirectory);
  //     media = MessageMedia.fromFilePath(filedirectory);
  // }
  
  // Cek Session / Koneksi WA
  const id = sender
  const path_session_file = `./whatsapp-session-${id}.json`;
  let session_wa;
  if (fs.existsSync(path_session_file)) {
    session_wa = require(path_session_file);
  }

  if (!session_wa) {
    error = {
      sender: sender,
      status: false,
      code: 404,
      message: 'Unauthenticated Client'
    }
    console.log(error);
    return res.status(404).json(error);
  }

  const client = sessions.find(sess => sess.id == sender).client;

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    error = {
      status: false,
      code: 422,
      message: 'The number is not registered'
    }
    console.log(error);
    return res.status(422).json(error);
  }

  if (document) {
    client.sendMessage(number, media, {
      caption: message
    }).then(response => {
      res.status(200).json({
        status: true,
        code: 200,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        code: 500,
        response: err
      });
    });
    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        code: 200,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        code: 500,
        response: err
      });
    });
  } else {
    client.sendMessage(number, media, {
      caption: message
    }).then(response => {
      res.status(200).json({
        status: true,
        code: 200,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        code: 500,
        response: err
      });
    });
  }
});

const util = require('util');
const logFile = fs.createWriteStream('app.log', { flags: 'a' });
// Or 'w' to truncate the file every time the process starts.
const logStdout = process.stdout;

console.log = function () {
  logFile.write(util.format.apply(null, arguments) + '\n');
  logStdout.write(util.format.apply(null, arguments) + '\n');
}
console.error = console.log;

server.listen(port, function() {
  console.log('App running on *: ' + port);
});
