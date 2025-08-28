import path from 'path';
import fs from 'fs';
import multer from 'multer';

const __filename = process.env.BASE_PATH || process.cwd();

const port = process.env.PORT || 3000;

const delayMin = process.env.DELAY_MIN || 5000;
const delayMax = process.env.DELAY_MAX || 9000;

//Diretorio /src
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'fila.db');

// Carrega Media para imagens 
const uploadsDir = path.join(__dirname, 'media/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Configuração do Multer para upload de arquivos
const upload = multer({
  dest: path.join(__dirname, uploadsDir), // Diretório temporário para uploads
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10MB para arquivos
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

export {
    path, 
    fs,
    port,
    __dirname,
    dbPath,
    upload,
    TELEGRAM_TOKEN,
    uploadsDir,
    delayMin,
    delayMax
}