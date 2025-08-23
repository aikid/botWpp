import fs from 'fs';

const DB_FILE = 'sessions.json';

let db = { 
  sessions: {}, 
  groups: {}, 
  linkedSessions: {}, 
  customLists: {}, 
  botControl: { enabled: false, allowedUsers: [], admins: ['@guilhermecugler', '935860725'] },
  queues: {} 
};


if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    for (const session in db.sessions) {
      if (!db.sessions[session].hasOwnProperty('name')) {
        db.sessions[session].name = '';
      }
    }
    if (!db.customLists) db.customLists = {};
    if (!db.botControl) db.botControl = { enabled: false, allowedUsers: [], admins: ['@guilhermecugler', '935860725'] };
    if (!db.queues) db.queues = {};
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    logger.error(`Erro ao carregar o banco de dados: ${err.message}`);
  }
} else {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    sessions: {}, 
    groups: {}, 
    linkedSessions: {}, 
    customLists: {}, 
    botControl: { enabled: false, allowedUsers: [], admins: ['@guilhermecugler', '935860725'] }, 
    queues: {} 
  }, null, 2));
}

async function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    logger.error(`Erro ao salvar o banco de dados: ${err.message}`);
    throw err;
  }
}

export {saveDb, db};